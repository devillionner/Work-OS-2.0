// Durable Object: one instance per owner (idFromName(userId)), reached only through
// app/api/live/route.ts (WebSocket upgrades) and the waiting-check control route below (plain
// HTTP) — both have already authenticated the caller, so this class trusts them and does no auth
// of its own. Holds live process state in ctx.storage and relays commands/progress between the
// browser and the local runner over Hibernatable WebSockets, so neither side has to poll D1 to
// find out what the other is doing.
//
// D1 keeps only durable facts (chats, publications, qualification outcomes); "who is running,
// who owns the current task" lives here instead of the old time-limited lease/fencing columns —
// an open WebSocket connection *is* the ownership proof, so there is nothing to expire.
//
// Plain JS, not TypeScript: vinext builds with Wrangler's "no_bundle" mode, which uploads
// dist/server/*.js as separate ES modules without a bundling step, so this file cannot be
// deployed with its TypeScript imports below left unresolved. scripts/normalize-wrangler-config.mjs
// bundles this file (and the lib/chats/* modules the waiting_check business logic below calls)
// into one self-contained ES module with esbuild at build time, so the imports are real at build
// time and simply inlined by the time the file reaches dist/server. Tests cover the message-
// routing/storage/business-logic behavior directly (tests/owner-channel.test.mjs); IDE type hints
// come from the JSDoc below.
import {
  advanceWaitingCheckTask,
  applyWaitingCheckResult,
  createWaitingCheckBatch,
  enrichWaitingCheckProblems,
  isWaitingCheckBatchActive,
  readEligibleWaitingChats,
  releaseWaitingCheckTask,
  stopWaitingCheckBatch,
  waitingCheckStatusFromBatch,
} from '../lib/chats/whatsapp-waiting-check.ts';
import {
  claimWhatsAppAutopostJob,
  completeWhatsAppAutopostJob,
  releaseWhatsAppAutopostJob,
} from '../lib/messenger-automation.ts';
import { readDiscoveryExecutorQueue, completeDiscoveryExternalLeave } from '../lib/chat-discovery/executor.ts';
import { applyDiscoveryInspection } from '../lib/chat-discovery/inspection.ts';

/** @typedef {'browser'|'runner'} ChannelKind */
/** @typedef {'discovery'} GenericProcessName */
/** @typedef {{running: boolean, params: unknown, updatedAt: number}} GenericProcessState */
/** @typedef {{userId: string|null, processes: Record<GenericProcessName, GenericProcessState>, waitingCheckBatch: import('../lib/chats/whatsapp-waiting-check.ts').WaitingCheckBatchState|null, autopostCurrentJobId: string|null, discoveryCurrentTask: import('../lib/chat-discovery/executor.ts').DiscoveryExecutorTask|null, runnerLastSeenAt: number|null}} OwnerChannelState */

const STORAGE_KEY = 'state';
const PING = JSON.stringify({ type: 'ping' });
const PONG = JSON.stringify({ type: 'pong' });

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export class OwnerChannel {
  /**
   * @param {DurableObjectState} ctx
   * @param {Cloudflare.Env} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Hibernation-safe auto-response: a bare ping/pong never wakes the DO or runs JS.
    // WebSocketRequestResponsePair only exists in the real Workers runtime; tests exercise the
    // message-routing methods directly with a mock ctx that doesn't need it.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    }
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || '';

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.acceptChannel(request, url, userId);
    }
    if (url.pathname === '/waiting-check') {
      return this.handleWaitingCheckHttp(request, userId);
    }
    if (url.pathname === '/autopost-wake' && request.method === 'POST') {
      if (!userId) return new Response(null, { status: 401 });
      const state = await this.readState();
      if (state.userId !== userId) state.userId = userId;
      // Called after a create/batch/cancel on one device: other open tabs/devices reload their queue
      // (new "Автопост у черзі" badge, or a cancelled one gone) instead of finding out on next focus.
      this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: null, status: 'queue_changed' });
      await this.dispatchNextAutopostJob(state);
      await this.writeState(state);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/discovery-wake' && request.method === 'POST') {
      if (!userId) return new Response(null, { status: 401 });
      const state = await this.readState();
      if (state.userId !== userId) state.userId = userId;
      await this.dispatchNextDiscoveryTask(state);
      await this.writeState(state);
      return new Response(null, { status: 204 });
    }
    return new Response('Expected a WebSocket upgrade.', { status: 426 });
  }

  /**
   * @param {Request} request
   * @param {URL} url
   * @param {string} userId
   */
  async acceptChannel(request, url, userId) {
    /** @type {ChannelKind} */
    const kind = url.searchParams.get('kind') === 'runner' ? 'runner' : 'browser';
    const deviceId = url.searchParams.get('deviceId') || '';

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, deviceId ? [kind, `device:${deviceId}`] : [kind]);

    if (kind === 'browser') await this.onBrowserConnected(server, userId);
    else await this.onRunnerConnected(server, userId);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Connection bookkeeping kept separate from acceptChannel's WebSocketPair construction (which
   * only exists in the real Workers runtime) so it can be exercised directly against a mock socket
   * in tests, the same way webSocketMessage/webSocketClose already are.
   * @param {WebSocket} server
   * @param {string} userId
   */
  async onBrowserConnected(server, userId) {
    const state = await this.readState();
    if (userId && state.userId !== userId) { state.userId = userId; await this.writeState(state); }
    server.send(JSON.stringify({ type: 'hello', processes: state.processes, runnerConnected: this.openRunnerCount() > 0 }));
  }

  /**
   * @param {WebSocket} server
   * @param {string} userId
   */
  async onRunnerConnected(server, userId) {
    const state = await this.readState();
    if (userId && state.userId !== userId) state.userId = userId;
    state.runnerLastSeenAt = nowSeconds();
    // The only runner now connected cannot be working on anything yet: any in-flight task still
    // recorded belongs to a connection whose close was never processed (staging, before 2026-10-04,
    // left such claims stuck and blocked all further dispatch), so release it before dispatching.
    if (this.openRunnerCount(server) === 0) await this.releaseOrphanedTasks(state);
    server.send(JSON.stringify({ type: 'hello', processes: state.processes }));
    this.broadcast('browser', { type: 'runner_status', connected: true });
    // A runner that reconnects (sleep/network blip, not an explicit stop) must resume whatever
    // was running without the operator doing anything — the command itself never left D1/DO.
    for (const [name, process] of Object.entries(state.processes)) {
      if (process?.running) server.send(JSON.stringify({ type: 'command', process: name, action: 'start', params: process.params }));
    }
    if (isWaitingCheckBatchActive(state.waitingCheckBatch)) {
      // advanceWaitingCheckTask returns the already-set `current` as-is when one exists, which is
      // exactly "resume the task that was in flight" — the DO never learned whether the runner
      // finished it before the disconnect, so it is safe/idempotent to just resend it.
      const { batch, task } = advanceWaitingCheckTask(state.waitingCheckBatch, nowSeconds());
      state.waitingCheckBatch = batch;
      if (task) server.send(JSON.stringify({ type: 'task', process: 'waiting_check', task }));
    }
    // Unlike waiting_check's in-memory batch, an autopost job row lives in D1: a disconnect already
    // released any in-flight job back to 'pending' (see webSocketClose), so reconnect just looks for
    // new work instead of resuming anything specific.
    await this.dispatchNextAutopostJob(state);
    // Discovery's per-candidate task is never written to D1 at dispatch time (see
    // dispatchNextDiscoveryTask), so a disconnect left D1 untouched; webSocketClose only had to forget
    // the in-memory discoveryCurrentTask, and a fresh read here finds the same candidate again.
    await this.dispatchNextDiscoveryTask(state);
    await this.writeState(state);
  }

  /**
   * @param {Request} request
   * @param {string} userId
   */
  async handleWaitingCheckHttp(request, userId) {
    if (!userId) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
    const now = nowSeconds();
    const state = await this.readState();
    if (state.userId !== userId) state.userId = userId;

    if (request.method === 'GET') {
      await this.writeState(state);
      return Response.json(await this.waitingCheckStatusJson(state, now), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'Некоректний запит.' }, { status: 400 }); }
      const error = await this.applyWaitingCheckCommand(state, body, now);
      if (error) return error;
      await this.writeState(state);
      const status = await this.waitingCheckStatusJson(state, now);
      // Start/stop from one device shows up on every other open tab/device without a poll.
      this.broadcast('browser', { type: 'process_state', process: 'waiting_check', ...status });
      return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response('Method not allowed', { status: 405 });
  }

  /**
   * @param {OwnerChannelState} state
   * @param {unknown} body
   * @param {number} now
   * @returns {Promise<Response|null>} a Response only for a rejected request; null means state was updated in place.
   */
  async applyWaitingCheckCommand(state, body, now) {
    const action = body && typeof body === 'object' ? /** @type {{action?:unknown}} */ (body).action : null;
    if (action === 'start' || action === 'retry_problems') {
      if (isWaitingCheckBatchActive(state.waitingCheckBatch)) return null;
      const onlyIds = action === 'retry_problems'
        ? new Set((state.waitingCheckBatch?.problems ?? []).map(problem => problem.chatId))
        : undefined;
      const items = await readEligibleWaitingChats(this.env.DB, /** @type {string} */ (state.userId), now);
      const batch = createWaitingCheckBatch(items, now, onlyIds);
      const { batch: advanced, task } = advanceWaitingCheckTask(batch, now);
      state.waitingCheckBatch = advanced;
      if (task) this.broadcast('runner', { type: 'task', process: 'waiting_check', task });
      return null;
    }
    if (action === 'stop') {
      const wasActive = isWaitingCheckBatchActive(state.waitingCheckBatch);
      const batchId = state.waitingCheckBatch?.batchId;
      state.waitingCheckBatch = stopWaitingCheckBatch(state.waitingCheckBatch, now);
      // Fencing alone only rejects the in-flight chat's result; telling the runner lets it abort that
      // check before anything is pressed in WhatsApp, so Stop is immediate on the PC too.
      if (wasActive) this.broadcast('runner', { type: 'cancel', process: 'waiting_check', batchId });
      return null;
    }
    return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  }

  /**
   * @param {OwnerChannelState} state
   * @param {number} now
   */
  async waitingCheckStatusJson(state, now) {
    const base = waitingCheckStatusFromBatch(state.waitingCheckBatch);
    const rawProblems = state.waitingCheckBatch?.problems ?? [];
    const problems = base.active ? rawProblems : await enrichWaitingCheckProblems(this.env.DB, /** @type {string} */ (state.userId), rawProblems, now);
    const runnerConnected = this.openRunnerCount() > 0;
    return { ...base, problems, runnerSeenAt: runnerConnected ? now : (state.runnerLastSeenAt ?? null) };
  }

  /**
   * @param {WebSocket} ws
   * @param {string|ArrayBuffer} raw
   */
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'ping') { ws.send(PONG); return; }

    if (message.type === 'command') {
      const state = await this.readState();
      state.processes[message.process] = { running: message.action === 'start', params: message.params ?? null, updatedAt: Date.now() };
      await this.writeState(state);
      this.broadcast('runner', message);
      this.broadcast('browser', { type: 'process_state', process: message.process, ...state.processes[message.process] });
      return;
    }

    if (message.process === 'waiting_check') {
      if (message.type === 'result') return this.handleWaitingCheckResult(message);
      if (message.type === 'release') return this.handleWaitingCheckRelease(message);
      // Explicit "give me work" after the runner's own backoff following a release — see
      // releaseWaitingCheckTask for why the DO does not redispatch on its own there.
      if (message.type === 'ready') return this.handleWaitingCheckReady(ws);
      return;
    }

    if (message.process === 'autopost') {
      if (message.type === 'result') return this.handleAutopostResult(message);
      // 'release' (runtime problem) and 'ready' (resume after the runner's own backoff) mirror
      // waiting_check's protocol exactly — see releaseWhatsAppAutopostJob's comment for why a
      // release does not immediately redispatch.
      if (message.type === 'release') return this.handleAutopostRelease(message);
      if (message.type === 'ready') return this.handleAutopostReady(ws);
      return;
    }

    if (message.process === 'discovery') {
      // Only the per-candidate executor protocol (join/inspect/leave) is real business logic here.
      // The Discovery autonomous run (source crawl goal/cursor) still speaks the generic
      // command/progress relay above/below by design — see commit 3's plan for why that layer stays
      // separate from this per-candidate lease migration.
      if (message.type === 'result') return this.handleDiscoveryResult(message);
      if (message.type === 'release') return this.handleDiscoveryRelease(message);
      if (message.type === 'ready') return this.handleDiscoveryReady(ws);
    }

    if (message.type === 'progress' || message.type === 'result') {
      this.broadcast('browser', message);
    }
  }

  /** @param {{batchId:number; chatId:string; status:import('../lib/chats/whatsapp-waiting-check.ts').WaitingCheckOutcome; reason?:string; observedName?:string}} message */
  async handleWaitingCheckResult(message) {
    const now = nowSeconds();
    const state = await this.readState();
    if (!state.userId || !isWaitingCheckBatchActive(state.waitingCheckBatch)) return;
    const applied = await applyWaitingCheckResult(this.env.DB, state.userId, state.waitingCheckBatch, message, now);
    if (!applied) return; // stale/mismatched result (e.g. a stop already fenced this chat) — ignore
    const { batch, task } = advanceWaitingCheckTask(applied.batch, now);
    state.waitingCheckBatch = batch;
    await this.writeState(state);
    if (task) this.broadcast('runner', { type: 'task', process: 'waiting_check', task });
    this.broadcast('browser', { type: 'process_state', process: 'waiting_check', ...(await this.waitingCheckStatusJson(state, now)) });
  }

  /** @param {{batchId:number; chatId:string}} message */
  async handleWaitingCheckRelease(message) {
    const now = nowSeconds();
    const state = await this.readState();
    const released = releaseWaitingCheckTask(state.waitingCheckBatch, message, now);
    if (!released) return;
    state.waitingCheckBatch = released;
    await this.writeState(state);
  }

  /** @param {WebSocket} ws */
  async handleWaitingCheckReady(ws) {
    const now = nowSeconds();
    const state = await this.readState();
    if (!isWaitingCheckBatchActive(state.waitingCheckBatch)) return;
    const { batch, task } = advanceWaitingCheckTask(state.waitingCheckBatch, now);
    state.waitingCheckBatch = batch;
    await this.writeState(state);
    if (task) ws.send(JSON.stringify({ type: 'task', process: 'waiting_check', task }));
  }

  /**
   * Claims the next pending WhatsApp autopost job and pushes it to the runner, unless one is
   * already in flight. Called after a browser create/cancel wakes the DO, after a runner connects,
   * and after a result/ready — the same "one task in flight, advance on completion" shape as
   * waiting_check, just backed by a durable D1 row instead of an in-memory queue snapshot.
   * @param {OwnerChannelState} state
   */
  async dispatchNextAutopostJob(state) {
    if (state.autopostCurrentJobId || !state.userId) return;
    const task = await claimWhatsAppAutopostJob(this.env.DB, state.userId, nowSeconds());
    if (!task) return;
    state.autopostCurrentJobId = task.jobId;
    this.broadcast('runner', { type: 'task', process: 'autopost', task });
    this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: task.jobId, status: 'running' });
  }

  /** @param {{jobId:string; status:string; observedTarget?:string; targetVerified?:boolean; sendConfirmed?:boolean; errorCode?:string}} message */
  async handleAutopostResult(message) {
    const state = await this.readState();
    if (!state.userId || state.autopostCurrentJobId !== message.jobId) return; // stale/mismatched — ignore
    state.autopostCurrentJobId = null;
    try { await completeWhatsAppAutopostJob(this.env.DB, state.userId, message, nowSeconds()); }
    catch { /* job already resolved another way (e.g. operator cancel) — nothing left to apply */ }
    // Sent before the next dispatch so a browser sees this job finish before the next one starts;
    // either way it reloads its queue, which is where the authoritative job status lives.
    this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: message.jobId, status: String(message.status || '') });
    await this.dispatchNextAutopostJob(state);
    await this.writeState(state);
  }

  /** @param {{jobId:string}} message */
  async handleAutopostRelease(message) {
    const state = await this.readState();
    if (!state.userId || state.autopostCurrentJobId !== message.jobId) return;
    await releaseWhatsAppAutopostJob(this.env.DB, state.userId, message.jobId, nowSeconds());
    state.autopostCurrentJobId = null;
    await this.writeState(state);
    this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: message.jobId, status: 'released' });
  }

  /** @param {WebSocket} _ws */
  async handleAutopostReady(_ws) {
    const state = await this.readState();
    await this.dispatchNextAutopostJob(state);
    await this.writeState(state);
  }

  /**
   * Picks the next Discovery per-candidate task (join/inspect/leave) and pushes it to the runner,
   * unless one is already in flight. Unlike autopost's claim, there is nothing to write to D1 first:
   * the candidate rows this reads carry no lease columns anymore (retired in commit 3d) — the open
   * WebSocket plus this in-memory discoveryCurrentTask are the only ownership proof, the same as
   * waiting_check's batch. A disconnect (webSocketClose) only has to forget discoveryCurrentTask, not
   * undo any D1 write, so a later reconnect's fresh read naturally finds the same candidate again.
   * @param {OwnerChannelState} state
   */
  async dispatchNextDiscoveryTask(state) {
    if (state.discoveryCurrentTask || !state.userId) return;
    const { tasks } = await readDiscoveryExecutorQueue(this.env.DB, state.userId, 1, nowSeconds());
    const task = tasks[0];
    if (!task) return;
    state.discoveryCurrentTask = task;
    this.broadcast('runner', { type: 'task', process: 'discovery', task });
  }

  /** @param {{candidateId:string; result?:unknown; chatStateToken?:string; targetVerified?:unknown}} message */
  async handleDiscoveryResult(message) {
    const state = await this.readState();
    const current = state.discoveryCurrentTask;
    if (!state.userId || !current || current.candidateId !== message.candidateId) return; // stale/mismatched — ignore
    state.discoveryCurrentTask = null;
    const now = nowSeconds();
    try {
      if (current.resultAction === 'executor-leave') {
        await completeDiscoveryExternalLeave(this.env.DB, state.userId, {
          candidateId: message.candidateId,
          expectedVersion: current.candidateVersion,
          chatStateToken: message.chatStateToken,
          targetVerified: message.targetVerified,
        }, now);
      } else {
        await applyDiscoveryInspection(this.env.DB, state.userId, {
          candidateId: message.candidateId,
          expectedVersion: current.candidateVersion,
          result: message.result,
          minMembers: current.minMembers,
          requireTargetVerification: true,
        }, now);
      }
    } catch { /* candidate/chat already changed another way (e.g. operator action) — nothing left to apply */ }
    await this.dispatchNextDiscoveryTask(state);
    await this.writeState(state);
  }

  /** @param {{candidateId:string}} message */
  async handleDiscoveryRelease(message) {
    const state = await this.readState();
    if (!state.discoveryCurrentTask || state.discoveryCurrentTask.candidateId !== message.candidateId) return;
    // A technical problem (WhatsApp Web failed to load, CDP unreachable) is not tied to this one
    // candidate — do not redispatch immediately, or a persistent global problem becomes a tight retry
    // loop. The runner sends its own 'ready' once it is done backing off (same protocol as waiting_check/autopost).
    state.discoveryCurrentTask = null;
    await this.writeState(state);
  }

  /** @param {WebSocket} _ws */
  async handleDiscoveryReady(_ws) {
    const state = await this.readState();
    await this.dispatchNextDiscoveryTask(state);
    await this.writeState(state);
  }

  /**
   * @param {WebSocket} ws
   * @param {number} _code
   * @param {string} _reason
   * @param {boolean} _wasClean
   */
  async webSocketClose(ws, _code, _reason, _wasClean) {
    // Complete the close handshake from our side too (harmless if it is already closed).
    try { ws.close(1000, 'closed'); } catch { /* already closed */ }
    if (this.tagsOf(ws).includes('runner') && this.openRunnerCount(ws) === 0) {
      const state = await this.readState();
      state.runnerLastSeenAt = nowSeconds();
      await this.releaseOrphanedTasks(state);
      await this.writeState(state);
      this.broadcast('browser', { type: 'runner_status', connected: false });
    }
  }

  /**
   * In-flight autopost/Discovery tasks owned by a runner connection that no longer exists.
   * @param {OwnerChannelState} state
   */
  async releaseOrphanedTasks(state) {
    // The runner's connection is the only ownership proof an autopost claim has — losing it
    // means whatever job was in flight must go back to 'pending' instead of waiting on a timeout.
    if (state.autopostCurrentJobId && state.userId) {
      await releaseWhatsAppAutopostJob(this.env.DB, state.userId, state.autopostCurrentJobId, nowSeconds());
      this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: state.autopostCurrentJobId, status: 'released' });
    }
    state.autopostCurrentJobId = null;
    // Discovery's task was never written to D1, so losing the connection just means forgetting it
    // here — the next dispatch reads D1 fresh and finds it again.
    state.discoveryCurrentTask = null;
  }

  /**
   * @param {WebSocket} ws
   * @param {unknown} _error
   */
  async webSocketError(ws, _error) {
    await this.webSocketClose(ws, 1011, 'error', false);
  }

  /**
   * Runner sockets that are really open. Found live on staging (2026-10-04): inside webSocketClose the
   * runtime still lists the closing socket in getWebSockets(), so a plain length check never saw "no
   * runner left" — the browsers were never told the runner went offline and runnerLastSeenAt kept the
   * connect time. Counting only OPEN sockets other than the closing one works either way.
   * @param {WebSocket|null} [except]
   */
  openRunnerCount(except = null) {
    return this.ctx.getWebSockets('runner').filter((socket) => socket !== except && socket.readyState === 1).length;
  }

  /** @param {WebSocket} ws */
  tagsOf(ws) {
    return this.ctx.getTags(ws);
  }

  /**
   * @param {ChannelKind} kind
   * @param {unknown} message
   */
  broadcast(kind, message) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets(kind)) {
      try { socket.send(payload); } catch { /* socket closing concurrently; next close event cleans up */ }
    }
  }

  /** @returns {Promise<OwnerChannelState>} */
  async readState() {
    const stored = await this.ctx.storage.get(STORAGE_KEY);
    return stored ?? { userId: null, processes: {}, waitingCheckBatch: null, autopostCurrentJobId: null, discoveryCurrentTask: null, runnerLastSeenAt: null };
  }

  /** @param {OwnerChannelState} state */
  async writeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }
}
