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
import { previewTelegramDiscoveryText, readDiscoveryTelegramGroupSources } from '../lib/chat-discovery/local-preview.ts';
import chatDiscoverySeeds from '../lib/chat-discovery/seeds.ts';
import {
  applyResult as applyRunResult,
  applySourceBatch,
  canResume,
  clearActive,
  markActive,
  markConfirmed,
  moveToNonTarget,
  needsSourceStep,
  nextCandidateTask,
  nextSkipExpiry,
  pauseOnSourceBlock,
  pauseRun,
  releaseCandidate,
  removeCandidates,
  resumeRun,
  retryCandidate,
  settleRun,
  startRun,
  updateSourceFeedback,
} from '../lib/chat-discovery/run-state.ts';
import { loadRun, loadSourceFeedback, loadTelegramGroups, saveRun, saveSourceFeedback, saveTelegramGroups } from '../lib/chat-discovery/run-store.ts';

/** @typedef {'browser'|'runner'} ChannelKind */
/** @typedef {'discovery'} GenericProcessName */
/** @typedef {{running: boolean, params: unknown, updatedAt: number}} GenericProcessState */
/** @typedef {{userId: string|null, processes: Record<GenericProcessName, GenericProcessState>, waitingCheckBatch: import('../lib/chats/whatsapp-waiting-check.ts').WaitingCheckBatchState|null, autopostCurrentJobId: string|null, discoveryCurrentTask: import('../lib/chat-discovery/executor.ts').DiscoveryExecutorTask|null, runnerLastSeenAt: number|null, runnerOnline?: boolean, discoveryRunJob?: {kind:'candidate', candidateId:string, runId:string}|{kind:'source', runId:string, cursor:number}|null, discoveryRunCandidatesBlockedUntil?: number, discoveryRunWakeAt?: number|null, discoverySourceActivity?: string|null}} OwnerChannelState */

const STORAGE_KEY = 'state';
// The runner pings every 30 s and the runtime records each auto-answered ping per socket. A runner socket
// with no ping (or connect) for this long is dead even if its close never reached this object.
const RUNNER_STALE_MS = 75_000;
// While a runner is believed connected, an alarm re-checks those ping times (no D1) so a PC that loses
// power or network shows as offline everywhere within about two minutes, not only on a clean close.
const RUNNER_WATCH_MS = 90_000;
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
    if (url.pathname === '/discovery-run') {
      return this.handleDiscoveryRunHttp(request, userId);
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
    // A per-connection tag identifies "this socket" without relying on object identity, which the
    // runtime does not guarantee between the close handler and getWebSockets().
    const connTag = `conn:${crypto.randomUUID()}`;
    this.ctx.acceptWebSocket(server, deviceId ? [kind, connTag, `device:${deviceId}`] : [kind, connTag]);
    server.serializeAttachment({ connectedAt: Date.now() });

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
    state.runnerOnline = true;
    await this.scheduleRunnerWatch();
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
    const run = await loadRun(this.ctx.storage);
    if (run.running && run.runId) {
      server.send(JSON.stringify(await this.runPlanMessage(run.runId)));
      await this.dispatchRun(state);
    }
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
      // Status first: it may find the runner dead by ping time and update state (see markRunnerOffline).
      const status = await this.waitingCheckStatusJson(state, now);
      await this.writeState(state);
      return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'Некоректний запит.' }, { status: 400 }); }
      const error = await this.applyWaitingCheckCommand(state, body, now);
      if (error) return error;
      const status = await this.waitingCheckStatusJson(state, now);
      await this.writeState(state);
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
    if (!runnerConnected && state.runnerOnline) await this.markRunnerOffline(state);
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

    if (message.process === 'discovery_run') return this.handleDiscoveryRunMessage(ws, message);

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
      await this.markRunnerOffline(state, nowSeconds());
      await this.writeState(state);
    }
  }

  // Alarm: re-check runner liveness by ping times while a runner is believed connected.
  async alarm() {
    const state = await this.readState();
    if (state.runnerOnline && this.openRunnerCount() === 0) await this.markRunnerOffline(state);
    if (state.discoveryRunWakeAt && state.discoveryRunWakeAt <= Date.now()) {
      state.discoveryRunWakeAt = null;
      await this.dispatchRun(state);
    }
    await this.scheduleAlarm(state);
    await this.writeState(state);
  }

  /**
   * One alarm per object: the earliest of the runner liveness re-check (while a runner is believed
   * connected) and the moment a cooled-down Discovery run item becomes dispatchable again.
   * @param {OwnerChannelState} state
   */
  async scheduleAlarm(state) {
    const times = [];
    if (state.runnerOnline) times.push(Date.now() + RUNNER_WATCH_MS);
    if (state.discoveryRunWakeAt && state.discoveryRunWakeAt > Date.now()) times.push(state.discoveryRunWakeAt);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async scheduleRunnerWatch() {
    await this.ctx.storage.setAlarm(Date.now() + RUNNER_WATCH_MS);
  }

  /**
   * Runner gone (clean close, or found dead by ping time): remember when it was last seen, release its
   * in-flight tasks and tell every browser. Idempotent through state.runnerOnline.
   * @param {OwnerChannelState} state
   * @param {number|null} [seenAt] seconds; defaults to the last ping/connect of any runner socket
   */
  async markRunnerOffline(state, seenAt = null) {
    const lastActivity = Math.max(0, ...this.ctx.getWebSockets('runner').map((socket) => this.lastActivityMs(socket)));
    state.runnerLastSeenAt = seenAt ?? (lastActivity ? Math.floor(lastActivity / 1000) : (state.runnerLastSeenAt ?? null));
    state.runnerOnline = false;
    await this.releaseOrphanedTasks(state);
    this.broadcast('browser', { type: 'runner_status', connected: false });
  }

  // --- Discovery autonomous run ("автопошук", process 'discovery_run') ---------------------------
  // State and rules: lib/chat-discovery/run-state.ts (stored by run-store.ts). At most ONE run item is in
  // flight: a WhatsApp check of a queued candidate takes priority, otherwise one Telegram source step when
  // the queue is short — the same turn-taking the runner's own loop did when the state lived in the tab
  // (both need their browser tab in the foreground). D1 is only read here (duplicate check of new invites,
  // and the owner's joined Telegram groups once per run start); results reach D1 only through the
  // operator's «Підтвердити» / «Архівувати всі».

  /** @param {string} runId */
  async runPlanMessage(runId) {
    return { type: 'run_plan', process: 'discovery_run', runId, seedData: chatDiscoverySeeds, telegramGroups: await loadTelegramGroups(this.ctx.storage) };
  }

  /** @param {import('../lib/chat-discovery/run-state.ts').DiscoveryRunState} run */
  broadcastRunState(run) {
    this.broadcast('browser', { type: 'process_state', process: 'discovery_run', runId: run.runId ?? null, running: run.running, done: run.done });
  }

  /**
   * Pushes the next run item to the runner unless one is already in flight.
   * @param {OwnerChannelState} state
   */
  async dispatchRun(state) {
    if (state.discoveryRunJob || this.openRunnerCount() === 0) return;
    const now = Date.now();
    let run = await loadRun(this.ctx.storage);
    if (!run.running || !run.runId) return;
    const blockedUntil = Number(state.discoveryRunCandidatesBlockedUntil) || 0;
    if (blockedUntil <= now) {
      const picked = nextCandidateTask(run, now);
      if (picked.state !== run) { await saveRun(this.ctx.storage, run, picked.state); run = picked.state; }
      if (picked.task) {
        state.discoveryRunJob = { kind: 'candidate', candidateId: picked.task.candidateId, runId: run.runId };
        state.discoverySourceActivity = null;
        this.broadcast('runner', { type: 'run_task', process: 'discovery_run', task: picked.task });
        return;
      }
    }
    if (needsSourceStep(run, now)) {
      state.discoveryRunJob = { kind: 'source', runId: run.runId, cursor: run.telegramCursor };
      this.broadcast('runner', { type: 'run_source', process: 'discovery_run', runId: run.runId, cursor: run.telegramCursor, feedback: await loadSourceFeedback(this.ctx.storage) });
      return;
    }
    const wakeTimes = [nextSkipExpiry(run, now), blockedUntil > now ? blockedUntil : null].filter((value) => value !== null);
    if (wakeTimes.length) {
      state.discoveryRunWakeAt = Math.min(.../** @type {number[]} */ (wakeTimes));
      await this.scheduleAlarm(state);
    }
  }

  /**
   * @param {WebSocket} ws
   * @param {any} message
   */
  async handleDiscoveryRunMessage(ws, message) {
    const state = await this.readState();
    // Ephemeral "what the runner is doing right now" for the dialog's status line — not part of the
    // durable run snapshot (changes every few seconds, nothing to resume from it). Only accepted while
    // this is genuinely the in-flight source step, so a stale/delayed message from an abandoned step
    // cannot overwrite a newer one.
    if (message.type === 'source_progress') {
      if (state.discoveryRunJob?.kind === 'source' && state.discoveryRunJob.runId === message.runId) {
        state.discoverySourceActivity = String(message.activity || '').slice(0, 200) || null;
        await this.writeState(state);
        this.broadcast('browser', { type: 'process_state', process: 'discovery_run', runId: message.runId });
      }
      return;
    }
    const job = state.discoveryRunJob;
    const now = Date.now();
    // A Telegram step's D1 duplicate check happens BEFORE the run is (re)loaded: awaiting D1 lets other
    // events in (a pause from a phone, for example), so the step must apply to the state as it is after
    // that, never to a copy loaded before it.
    const sourceOutcomes = message.type === 'source_result' ? await this.previewRunSources(message, now, /** @type {string} */ (state.userId)) : null;
    const run = await loadRun(this.ctx.storage);
    let next = run;

    if (message.type === 'progress') {
      next = markActive(run, { candidateId: String(message.candidateId || ''), runId: message.runId, name: message.name, link: message.link, checkpoint: message.checkpoint ?? null }, now) ?? run;
    } else if (message.type === 'result') {
      const candidateId = String(message.candidateId || '');
      const before = run.candidates.find((candidate) => candidate.id === candidateId);
      next = applyRunResult(run, candidateId, message.payload ?? {}, now) ?? run;
      if (job?.kind === 'candidate' && job.candidateId === candidateId) state.discoveryRunJob = null;
      if (next !== run && before && message.payload) {
        const payload = message.payload;
        await saveSourceFeedback(this.ctx.storage, updateSourceFeedback(await loadSourceFeedback(this.ctx.storage),
          (before.sources || []).map((source) => ({ sourceUrl: source.sourceUrl, decision: payload.decision, reasonCodes: payload.reasonCodes,
            memberCount: payload.result?.memberCount ?? null, canWrite: payload.result?.canWrite ?? null })), now));
      }
    } else if (message.type === 'release') {
      const candidateId = String(message.candidateId || '');
      next = releaseCandidate(run, candidateId, Number(message.until) || now + 15_000);
      // A WhatsApp-runtime problem (not this chat's): give Telegram steps the turn until it passes.
      if (Number(message.runtimeBlockedUntil) > now) state.discoveryRunCandidatesBlockedUntil = Number(message.runtimeBlockedUntil);
      if (job?.kind === 'candidate' && job.candidateId === candidateId) state.discoveryRunJob = null;
    } else if (message.type === 'source_result') {
      // A partial result is one scanned group of a step still in progress: apply it now (it shows up on
      // every device right away and survives a Stop), but the step stays in flight.
      if (job?.kind === 'source' && job.runId === message.runId && !message.partial) state.discoveryRunJob = null;
      if (message.runId === run.runId && run.running && sourceOutcomes) {
        const applied = await this.applyRunSourceStep(run, message, sourceOutcomes, now);
        next = applied.state;
        const failed = sourceOutcomes.filter((outcome) => !outcome.ok);
        ws.send(JSON.stringify({ type: 'run_source_applied', process: 'discovery_run', runId: run.runId, added: applied.added, duplicates: applied.duplicates,
          extracted: sourceOutcomes.reduce((sum, outcome) => sum + (outcome.ok ? outcome.extracted ?? 0 : 0), 0),
          errors: failed.length, error: failed[0]?.reason ?? null, scannedGroups: Array.isArray(message.scannedGroups) ? message.scannedGroups : [] }));
      }
    } else if (message.type === 'pause') {
      if (job?.kind === 'source' && job.runId === message.runId) { state.discoveryRunJob = null; state.discoverySourceActivity = null; }
      if (message.runId === run.runId) {
        next = pauseOnSourceBlock(run, { reason: String(message.reason || 'telegram_unavailable'), query: String(message.query || '') }, now);
        if (next !== run) this.broadcast('runner', { type: 'run_control', process: 'discovery_run', runId: run.runId, active: false });
      }
    } else {
      return;
    }

    if (next !== run) {
      await saveRun(this.ctx.storage, run, next);
      this.broadcastRunState(next);
    }
    if (message.type !== 'progress' && !(message.type === 'source_result' && message.partial)) await this.dispatchRun(state);
    await this.writeState(state);
  }

  /**
   * Parses one crawled Telegram step's sources into WhatsApp-invite previews (duplicate check against D1,
   * read-only). Known links come from a snapshot; previews already in the run are skipped again when the
   * outcomes are merged into the fresh state (applySourceBatch).
   * @param {any} message
   * @param {number} now
   * @param {string} userId
   */
  async previewRunSources(message, now, userId) {
    const snapshot = await loadRun(this.ctx.storage);
    if (!userId || message.runId !== snapshot.runId || !snapshot.running) return null;
    const knownLinks = snapshot.candidates.map((candidate) => candidate.link).filter(Boolean);
    /** @type {import('../lib/chat-discovery/run-state.ts').SourcePreviewOutcome[]} */
    const outcomes = [];
    for (const raw of Array.isArray(message.sources) ? message.sources.slice(0, 40) : []) {
      const source = {
        sourceUrl: String(raw?.sourceUrl || '').slice(0, 1000), sourceTitle: String(raw?.sourceTitle || '').slice(0, 180),
        query: String(raw?.query || '').slice(0, 500), seedLabel: String(raw?.seedLabel || '').slice(0, 180),
        context: String(raw?.context || '').slice(0, 700), text: String(raw?.text || '').slice(0, 45_000),
      };
      if (!source.text || !source.sourceUrl) continue;
      try {
        const preview = await previewTelegramDiscoveryText(this.env.DB, userId, { ...source, knownLinks, minMembers: 700 }, Math.floor(now / 1000));
        for (const item of preview.previews) knownLinks.push(item.link);
        outcomes.push({ ok: true, sourceUrl: source.sourceUrl, previews: preview.previews, added: preview.batch.added, duplicates: preview.batch.duplicates, extracted: preview.batch.extracted });
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'preview_failed';
        console.warn('Discovery run source preview failed', reason);
        outcomes.push({ ok: false, sourceUrl: source.sourceUrl, query: source.query, reason });
      }
    }
    return outcomes;
  }

  /**
   * Merges a Telegram step's parsed previews into the (freshly loaded) run.
   * @param {import('../lib/chat-discovery/run-state.ts').DiscoveryRunState} run
   * @param {any} message
   * @param {import('../lib/chat-discovery/run-state.ts').SourcePreviewOutcome[]} outcomes
   * @param {number} now
   */
  async applyRunSourceStep(run, message, outcomes, now) {
    const batch = message.batch && typeof message.batch === 'object' ? message.batch : {};
    const applied = applySourceBatch(run, {
      nextCursor: Math.max(0, Number(batch.nextCursor) || 0), searched: Math.max(0, Number(batch.searched) || 0),
      done: batch.done === true, totalTasks: Math.max(0, Number(batch.totalTasks) || 0),
      errors: Array.isArray(batch.errors) ? batch.errors.slice(0, 8).map((item) => ({ reason: String(item?.reason || 'source_failed').slice(0, 300), query: String(item?.query || '').slice(0, 500) })) : [],
      warnings: Array.isArray(batch.warnings) ? batch.warnings.slice(0, 4).map((item) => ({ reason: String(item?.reason || 'source_warning').slice(0, 300), query: String(item?.query || '').slice(0, 500) })) : [],
    }, outcomes, now);
    if (applied.sourceStats.length) {
      await saveSourceFeedback(this.ctx.storage, updateSourceFeedback(await loadSourceFeedback(this.ctx.storage), applied.sourceStats, now));
    }
    return applied;
  }

  /**
   * Browser side of the run, bridged by app/api/chat-discovery/run/route.ts (session already verified).
   * @param {Request} request
   * @param {string} userId
   */
  async handleDiscoveryRunHttp(request, userId) {
    if (!userId) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
    const state = await this.readState();
    if (state.userId !== userId) state.userId = userId;
    const run = await loadRun(this.ctx.storage);
    if (request.method === 'GET') {
      await this.writeState(state);
      return Response.json({ run, runnerConnected: this.openRunnerCount() > 0, discoverySourceActivity: state.discoverySourceActivity ?? null, discoveryRunCandidatesBlockedUntil: state.discoveryRunCandidatesBlockedUntil ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Некоректний запит.' }, { status: 400 }); }
    const now = Date.now();
    const action = body?.action;
    let next = run;
    if (action === 'start') {
      if (run.running) return Response.json({ error: 'Автопошук уже працює.' }, { status: 409 });
      // One bounded D1 read per run start: the Telegram groups the owner's accounts already joined.
      try { await saveTelegramGroups(this.ctx.storage, (await readDiscoveryTelegramGroupSources(this.env.DB, userId)).groups); }
      catch { await saveTelegramGroups(this.ctx.storage, []); }
      next = startRun(run, { runId: crypto.randomUUID(), goal: body.goal, now });
    } else if (action === 'resume') {
      if (!canResume(run, now)) return Response.json({ error: 'Немає зупиненого автопошуку, який можна продовжити.' }, { status: 409 });
      next = resumeRun(run, now);
    } else if (action === 'pause') {
      if (!run.running) return Response.json({ run, runnerConnected: this.openRunnerCount() > 0, discoverySourceActivity: state.discoverySourceActivity ?? null, discoveryRunCandidatesBlockedUntil: state.discoveryRunCandidatesBlockedUntil ?? 0 });
      next = pauseRun(run, now);
    } else if (action === 'confirmed') {
      next = settleRun(markConfirmed(run, String(body.candidateId || '')), now);
    } else if (action === 'archived') {
      next = removeCandidates(run, Array.isArray(body.candidateIds) ? body.candidateIds.map(String).slice(0, 1000) : []);
    } else if (action === 'non-target') {
      next = moveToNonTarget(run, String(body.candidateId || ''));
    } else if (action === 'retry') {
      next = retryCandidate(run, String(body.candidateId || ''), now);
    } else {
      return Response.json({ error: 'Невідома дія.' }, { status: 400 });
    }
    if (next !== run) await saveRun(this.ctx.storage, run, next);
    // Start/resume/pause abandon whatever run item was in flight: after a pause the runner drops it
    // without answering, and a late answer is still applied (or ignored) on its own merits.
    if (action === 'start' || action === 'resume' || action === 'pause') { state.discoveryRunJob = null; state.discoverySourceActivity = null; }
    if (action === 'start' || action === 'resume') {
      if (next.runId) this.broadcast('runner', await this.runPlanMessage(next.runId));
      this.broadcast('runner', { type: 'run_control', process: 'discovery_run', runId: next.runId, active: true });
      state.discoveryRunCandidatesBlockedUntil = 0;
      await this.dispatchRun(state);
    } else if (action === 'pause') {
      // Like Stop in the Waiting check: the runner drops the run before its next WhatsApp/Telegram action.
      this.broadcast('runner', { type: 'run_control', process: 'discovery_run', runId: run.runId, active: false });
    }
    if (next !== run) this.broadcastRunState(next);
    await this.writeState(state);
    return Response.json({ run: next, runnerConnected: this.openRunnerCount() > 0, discoverySourceActivity: state.discoverySourceActivity ?? null, discoveryRunCandidatesBlockedUntil: state.discoveryRunCandidatesBlockedUntil ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
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
    // The autonomous run's in-flight item lives only in DO storage; forgetting the job (and the active
    // marker) lets the next runner get the same candidate or Telegram step again.
    if (state.discoveryRunJob) {
      state.discoveryRunJob = null;
      state.discoverySourceActivity = null;
      const run = await loadRun(this.ctx.storage);
      const cleared = clearActive(run);
      if (cleared !== run) await saveRun(this.ctx.storage, run, cleared);
    }
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
    const exceptTag = except ? this.connTagOf(except) : null;
    const now = Date.now();
    return this.ctx.getWebSockets('runner').filter((socket) => {
      if (socket === except || socket.readyState !== 1) return false;
      if (exceptTag && this.connTagOf(socket) === exceptTag) return false;
      const last = this.lastActivityMs(socket);
      return last === 0 || now - last < RUNNER_STALE_MS;
    }).length;
  }

  /** @param {WebSocket} ws */
  connTagOf(ws) {
    return this.tagsOf(ws).find((tag) => tag.startsWith('conn:')) ?? null;
  }

  /**
   * Last sign of life of a socket in ms: its latest auto-answered ping, else when it connected; 0 when
   * neither is known.
   * @param {WebSocket} ws
   */
  lastActivityMs(ws) {
    const ping = this.ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime?.() ?? 0;
    let connectedAt = 0;
    try { connectedAt = Number(ws.deserializeAttachment?.()?.connectedAt) || 0; } catch { /* no attachment */ }
    return Math.max(ping, connectedAt);
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
    return stored ?? { userId: null, processes: {}, waitingCheckBatch: null, autopostCurrentJobId: null, discoveryCurrentTask: null, runnerLastSeenAt: null, runnerOnline: false };
  }

  /** @param {OwnerChannelState} state */
  async writeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }
}
