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
import { businessDate } from '../lib/business-time.ts';
import { pushToOwner } from '../lib/push-store.ts';
import {
  claimWhatsAppAutopostJob,
  completeWhatsAppAutopostJob,
  releaseClaimedAutopostJobs,
  readWhatsAppAutopostProgress,
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
/** @typedef {{userId: string|null, processes: Record<GenericProcessName, GenericProcessState>, waitingCheckBatch: import('../lib/chats/whatsapp-waiting-check.ts').WaitingCheckBatchState|null, autopostCurrentJobId?: string|null, autopostClaimedAt?: number, autopostLanes?: Record<string, {jobId: string, claimedAt: number, current: {send: boolean, startedAt: number, platform: string}}|undefined>, autopostWatchAt?: number, runnerConnectedAt?: number, autopostPaused?: Record<string, number>, autopostCurrent?: {telegramSend: boolean, startedAt: number, platform?: string}, telegramPace?: {intervalSeconds:number, nextAt:number}, autopostPace?: Record<string, {intervalSeconds:number, nextAt:number}>, autopostStatus?: Record<string, {state:string, reason:string|null, text:string, identity?:string|null, until:number|null}>, viberStatus?: {state:string, reason:string|null, text:string}, autopostTrace?: {at:number, text:string}[], discoveryCurrentTask: import('../lib/chat-discovery/executor.ts').DiscoveryExecutorTask|null, runnerLastSeenAt: number|null, runnerOnline?: boolean, runnerVersion?: string, runnerOfflineAt?: number, pushSentAt?: Record<string, number>, autopostBatchOpen?: Record<string, number>, discoveryRunJob?: {kind:'candidate', candidateId:string, runId:string}|{kind:'source', runId:string, cursor:number}|null, discoveryRunCandidatesBlockedUntil?: number, discoveryRunWakeAt?: number|null, discoverySourceActivity?: string|null}} OwnerChannelState */

const STORAGE_KEY = 'state';
// The runner pings every 30 s and the runtime records each auto-answered ping per socket. A runner socket
// with no ping (or connect) for this long is dead even if its close never reached this object.
const RUNNER_STALE_MS = 75_000;
// While a runner is believed connected, an alarm re-checks those ping times (no D1) so a PC that loses
// power or network shows as offline everywhere within about two minutes, not only on a clean close.
const RUNNER_WATCH_MS = 90_000;
/** Задача автопосту «в роботі» довше за це вважається покинутою (один чат — 15–30 с, тайм-аути runner — до кількох хвилин). */
const AUTOPOST_LEASE_SECONDS = 600;
/** Платформа задачі автопосту за її видом: браузер перечитує лише ту платформу, якої стосується подія. */
const autopostPlatformOfKind = (/** @type {string} */ kind) => (kind === 'viber_android' ? 'viber' : kind === 'telegram_autopost' ? 'telegram' : 'whatsapp');
/** Скільки останніх рішень про видачу автопосту DO пам'ятає й показує runner після підключення. */
const AUTOPOST_TRACE_LIMIT = 40;
const AUTOPOST_TRACE_REPLAY = 15;
/** Після повернення задачі в чергу DO сам перевіряє чергу через стільки, якщо runner не попросив наступну (спільний ready міг загубитись). */
const AUTOPOST_WATCH_MS = 180_000;
// Сповіщення на телефон: одну причину не частіше за раз на 30 хв, тиха година 22:00-08:00 за Києвом.
const PUSH_REASON_GAP_MS = 30 * 60_000;
const PUSH_RUNNER_OFFLINE_MS = 10 * 60_000;
const PUSH_AUTOPOST_STALL_MS = 15 * 60_000;
const PUSH_PLATFORM_NAMES = { whatsapp: 'WhatsApp', viber: 'Viber', telegram: 'Telegram' };
const PUSH_LOGIN_REASONS = { whatsapp_not_authenticated: 'WhatsApp', telegram_not_authenticated: 'Telegram' };
/** @param {number} ms */
function kyivHour(ms) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Kyiv' }).format(ms));
}
/** Інтервал між публікаціями Telegram, якщо оператор ще не вибирав «на годину»: 5 на годину. */
const TELEGRAM_DEFAULT_INTERVAL_SECONDS = 720;
const AUTOPOST_PLATFORMS = ['whatsapp', 'viber', 'telegram'];
/**
 * Два канали видачі, що працюють паралельно: Viber керує Android через adb, а WhatsApp і Telegram ділять одну вкладку браузера
 * (їх у runner усе одно виконує по черзі). Платформи в різних каналах не чекають одна одну.
 */
const AUTOPOST_LANES = ['browser', 'viber'];
const laneOfPlatform = (/** @type {string} */ platform) => (platform === 'viber' ? 'viber' : 'browser');
const platformsOfLane = (/** @type {string} */ lane) => AUTOPOST_PLATFORMS.filter((platform) => laneOfPlatform(platform) === lane);
/** Інтервал між відправками платформи, якщо оператор не вибирав: Telegram — 5 на годину, решта — без пауз. */
const defaultIntervalSeconds = (/** @type {string} */ platform) => (platform === 'telegram' ? TELEGRAM_DEFAULT_INTERVAL_SECONDS : 0);
/** Подія, що тримає чергу обробників довше за це, не блокує наступні (D1 міг не відповісти). */
const SERIAL_MAX_WAIT_MS = 60_000;
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
    /** Черга обробників подій: кожен читає стан, чекає D1 і пише його назад (див. serial). */
    this.chain = Promise.resolve();
    // Hibernation-safe auto-response: a bare ping/pong never wakes the DO or runs JS.
    // WebSocketRequestResponsePair only exists in the real Workers runtime; tests exercise the
    // message-routing methods directly with a mock ctx that doesn't need it.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    }
  }

  /**
   * Усі події (HTTP, повідомлення, закриття, будильник) виконуються по черзі. Кожен обробник читає стан DO, чекає
   * D1 і пише стан назад; без черги події, що перетинались у часі, затирали одна одній зміни (2026-10-18: задача
   * автопосту лишилась `claimed` у D1, а DO «забув» про неї — Viber не стартував). Подія, що завислa довше за
   * SERIAL_MAX_WAIT_MS, наступні не блокує.
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  serial(work) {
    const run = this.chain.then(work);
    let timer;
    const cap = new Promise((resolve) => { timer = setTimeout(resolve, SERIAL_MAX_WAIT_MS); timer?.unref?.(); });
    this.chain = Promise.race([run.then(() => {}, () => {}), cap]).then(() => clearTimeout(timer));
    return run;
  }

  /** @param {Request} request */
  fetch(request) {
    return this.serial(() => this.handleFetch(request));
  }

  /** @param {Request} request */
  async handleFetch(request) {
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
      // «Зупинити» скасовує задачі в D1, але runner уже може виконувати одну з них: кажемо йому припинити до відправки.
      for (const lane of AUTOPOST_LANES) {
        const slot = state.autopostLanes?.[lane];
        if (!slot?.jobId) continue;
        const current = await this.env.DB.prepare('SELECT status FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1')
          .bind(slot.jobId, userId).first();
        if (!current || current.status !== 'claimed') this.broadcast('runner', { type: 'cancel', process: 'autopost', jobId: slot.jobId });
      }
      // Дія оператора (старт, зупинка, рішення) знімає паузу: він міг якраз виправити причину.
      state.autopostPaused = undefined;
      // Темп платформ: `pace=viber:0,telegram:20` (0 — без пауз); старий параметр `telegramPerHour` лишається для сумісності.
      const paceParam = url.searchParams.get('pace') || '';
      const legacyPerHour = Number(url.searchParams.get('telegramPerHour'));
      const requested = paceParam.split(',').map((item) => item.split(':')).filter((pair) => AUTOPOST_PLATFORMS.includes(pair[0]));
      if (legacyPerHour >= 1 && legacyPerHour <= 60) requested.push(['telegram', String(legacyPerHour)]);
      for (const [platform, value] of requested) {
        const perHour = Number(value);
        if (!Number.isInteger(perHour) || perHour < 0 || perHour > 60) continue;
        state.autopostPace = { ...(state.autopostPace || {}), [platform]: { intervalSeconds: perHour ? Math.round(3600 / perHour) : 0, nextAt: state.autopostPace?.[platform]?.nextAt ?? 0 } };
        this.broadcastPace(state, platform);
      }
      this.autopostTrace(state, 'wake: з браузера', false);
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
    server.send(JSON.stringify({ type: 'hello', processes: state.processes, runnerConnected: this.openRunnerCount() > 0, ...(state.runnerVersion ? { runnerVersion: state.runnerVersion } : {}), ...(state.viberStatus ? { viberStatus: state.viberStatus } : {}), ...(state.autopostStatus ? { autopostStatus: state.autopostStatus } : {}), ...(state.autopostPace ? { autopostPace: state.autopostPace } : {}), ...(state.autopostPace?.telegram ? { telegramPace: state.autopostPace.telegram } : {}) }));
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
    state.runnerOfflineAt = undefined;
    state.runnerConnectedAt = Date.now();
    await this.scheduleRunnerWatch();
    // The only runner now connected cannot be working on anything yet: any in-flight task still
    // recorded belongs to a connection whose close was never processed (staging, before 2026-10-04,
    // left such claims stuck and blocked all further dispatch), so release it before dispatching.
    if (this.openRunnerCount(server) === 0) await this.releaseOrphanedTasks(state);
    server.send(JSON.stringify({ type: 'hello', processes: state.processes }));
    for (const entry of (state.autopostTrace ?? []).slice(-AUTOPOST_TRACE_REPLAY)) server.send(JSON.stringify({ type: 'trace', at: entry.at, text: entry.text, replay: true }));
    this.autopostTrace(state, `runner підключено (відкритих: ${this.openRunnerCount()}), у роботі ${this.lanesText(state)}`, false);
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
    // Новий runner (перезапуск після виправлення) починає без паузи попереднього.
    state.autopostPaused = undefined;
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
  webSocketMessage(ws, raw) {
    return this.serial(() => this.handleSocketMessage(ws, raw));
  }

  /**
   * @param {WebSocket} ws
   * @param {string|ArrayBuffer} raw
   */
  async handleSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'ping') { ws.send(PONG); return; }
    // Після підключення runner каже, які задачі автопосту в нього справді в роботі: те, що DO видав раніше й чого runner не знає (завдання
    // пішло в мертвий сокет під час розриву зв'язку), повертається в чергу, а не чекає кінця оренди.
    if (message.type === 'runner_state' && Array.isArray(message.active)) return this.handleRunnerState(message.active.map(String));
    // Runner повідомляє свою версію (і що його щойно перезапустила іконка в треї після зміни коду): браузерам йде «Runner оновлено до …».
    if (message.type === 'runner_info') {
      const version = String(message.version || '').slice(0, 20);
      const state = await this.readState();
      state.runnerVersion = version;
      await this.writeState(state);
      this.broadcast('browser', { type: 'runner_status', connected: true, version, updated: message.updated === true });
      return;
    }

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

    if (message.type === 'progress' && message.process === 'autopost_status' && (message.platform === 'whatsapp' || message.platform === 'telegram')) {
      // Стан автопосту WhatsApp/Telegram від runner (пауза з причиною): запам'ятовуємо для сторінки, відкритої пізніше.
      const state = await this.readState();
      const status = { state: message.state === 'ready' ? 'ready' : 'blocked', reason: typeof message.reason === 'string' ? message.reason : null, text: typeof message.text === 'string' ? message.text.slice(0, 300) : '', identity: typeof message.identity === 'string' && /^[0-9]{3,20}$/.test(message.identity) ? message.identity : null, until: Number.isFinite(Number(message.until)) && Number(message.until) > 0 ? Number(message.until) : null };
      state.autopostStatus = { ...(state.autopostStatus || {}), [message.platform]: status };
      const loginName = status.state === 'blocked' && status.reason ? PUSH_LOGIN_REASONS[status.reason] : null;
      if (loginName) await this.notifyOwner(state, `login:${message.platform}`, { title: `${loginName} Web вийшов із сесії`, body: 'Потрібен вхід у браузері runner, автопост цієї платформи стоїть.', url: `/?go=platforms:${message.platform}:autopost`, tag: `login-${message.platform}` });
      await this.writeState(state);
    }
    if (message.type === 'progress' && message.process === 'viber_status') {
      // Стан Viber від runner приходить раз на хвилину; DO запам'ятовує його, щоб сторінка, відкрита між повідомленнями, показала його одразу.
      const state = await this.readState();
      state.viberStatus = { state: message.state === 'ready' ? 'ready' : message.state === 'busy' ? 'busy' : 'blocked', reason: typeof message.reason === 'string' ? message.reason : null, text: typeof message.text === 'string' ? message.text : '' };
      await this.writeState(state);
    }
    if (message.type === 'progress' && message.process === 'autopost_step' && typeof message.platform === 'string') {
      /** @type {Record<string, number>} */
      const steps = (this.stepAt ??= {});
      steps[message.platform] = Date.now();
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
   * Запис у короткий журнал рішень про видачу автопосту: лишається в стані DO, іде в журнал воркера й
   * (якщо runner підключений) у журнал runner, а новий runner отримує хвіст журналу одразу після підключення.
   * Інакше, коли задача «зависла», не видно, що саме DO вирішив і кому відправив.
   * @param {OwnerChannelState} state
   * @param {string} text
   * @param {boolean} [live] false — лише запам'ятати (до видачі задачі runner нічого зайвого не шлемо)
   */
  autopostTrace(state, text, live = true) {
    const trace = state.autopostTrace ?? [];
    trace.push({ at: Date.now(), text });
    state.autopostTrace = trace.slice(-AUTOPOST_TRACE_LIMIT);
    console.log(`[autopost] ${text}`);
    if (live) this.broadcast('runner', { type: 'trace', at: Date.now(), text });
  }

  /**
   * Claims the next pending WhatsApp autopost job and pushes it to the runner, unless one is
   * already in flight. Called after a browser create/cancel wakes the DO, after a runner connects,
   * and after a result/ready — the same "one task in flight, advance on completion" shape as
   * waiting_check, just backed by a durable D1 row instead of an in-memory queue snapshot.
   * @param {OwnerChannelState} state
   */
  async dispatchNextAutopostJob(state) {
    if (!state.userId) return;
    // Платформи, що зараз не видаються: пауза, яку попросив runner (середовище не готове, FloodWait), і ті, чий інтервал між відправками ще
    // не минув (там видаються лише проходи й перевірки). Для них нічого не читаємо з D1, а будильник ставимо на кінець очікування.
    const gates = this.autopostGates(state, Date.now());
    if (gates.platforms.length >= AUTOPOST_PLATFORMS.length) {
      this.autopostTrace(state, `видача: усі платформи чекають до ${new Date(gates.until).toISOString()}`, false);
      state.autopostWatchAt = gates.until + 1000;
      await this.scheduleAlarm(state);
      return;
    }
    const runners = this.openRunnerCount();
    // Рядки журналу до видачі йдуть у runner уже після самої задачі, щоб вона лишалась першим повідомленням.
    /** @type {string[]} */
    const notes = [];
    const flush = () => { for (const note of notes) this.autopostTrace(state, note); notes.length = 0; };
    state.autopostLanes ??= {};
    // Стан DO міг загубитись, а рядки `claimed` у D1 лишились: такі задачі не повинні ні блокувати чергу мовчки, ні видаватись удруге.
    const knownJobs = new Set(AUTOPOST_LANES.map((lane) => state.autopostLanes?.[lane]?.jobId).filter(Boolean));
    if (knownJobs.size < AUTOPOST_LANES.length) {
      const orphans = await this.env.DB.prepare(`SELECT id,updated_at,platform FROM whatsapp_autopost_jobs WHERE user_id=?1 AND status='claimed' ORDER BY updated_at LIMIT 4`)
        .bind(state.userId).all();
      for (const row of orphans.results || []) {
        const lane = laneOfPlatform(String(row.platform || 'whatsapp'));
        if (knownJobs.has(String(row.id)) || state.autopostLanes[lane]?.jobId) continue;
        state.autopostLanes[lane] = { jobId: String(row.id), claimedAt: Number(row.updated_at) * 1000, current: { send: true, startedAt: Number(row.updated_at) * 1000, platform: String(row.platform || 'whatsapp') } };
        knownJobs.add(String(row.id));
        notes.push(`видача: у D1 є задача ${row.id} у роботі, якої DO не пам'ятав`);
      }
    }
    let delivered = 0;
    let busy = 0;
    for (const lane of AUTOPOST_LANES) {
      const slot = state.autopostLanes[lane];
      if (slot?.jobId && !(await this.forgetStaleAutopostJob(state, lane))) {
        busy += 1;
        notes.push(`видача: задача ${slot.jobId} ще в роботі (канал ${lane}, runner: ${runners})`);
        continue;
      }
      if (runners === 0) continue;
      const lanePlatforms = platformsOfLane(lane);
      const excluded = [...AUTOPOST_PLATFORMS.filter((platform) => !lanePlatforms.includes(platform)), ...gates.platforms.filter((platform) => lanePlatforms.includes(platform))];
      const task = await claimWhatsAppAutopostJob(this.env.DB, state.userId, nowSeconds(), (row, reason) => {
        notes.push(`видача: задачу ${row.id} (${row.expected_name}) знято, причина ${reason}`);
      }, { excludePlatforms: excluded, skipPacedSends: gates.paced.filter((platform) => lanePlatforms.includes(platform)) });
      if (!task) continue;
      const platform = autopostPlatformOfKind(task.kind);
      state.autopostLanes[lane] = {
        jobId: task.jobId,
        claimedAt: Date.now(),
        // Вікно інтервалу займає лише справжня відправка (кнопку «Надіслати» натиснуто); це видно з результату, а не з видачі.
        current: { send: task.mode !== 'scan' && task.mode !== 'verify', startedAt: Date.now(), platform },
      };
      if (task.mode !== 'scan' && task.mode !== 'verify') (state.autopostBatchOpen ??= {})[platform] = Date.now();
      const sent = this.broadcast('runner', { type: 'task', process: 'autopost', task });
      notes.push(`видача: ${task.kind} ${task.jobId} «${task.target.expectedName}» → runner: відкритих ${runners}, доставлено ${sent}`);
      flush();
      this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: task.jobId, status: 'running', platform });
      // Ніхто не прийняв задачу: не тримаємо її за DO до кінця оренди, а повертаємо в чергу для runner, який підключиться.
      if (sent === 0) {
        await releaseWhatsAppAutopostJob(this.env.DB, state.userId, task.jobId, nowSeconds());
        state.autopostLanes[lane] = undefined;
        this.autopostTrace(state, `видача: runner не отримав задачу ${task.jobId}, повернуто в чергу`);
        this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: task.jobId, status: 'released', platform });
        continue;
      }
      delivered += 1;
    }
    if (runners === 0) this.autopostTrace(state, 'видача: runner не підключений, задачі лишаються в черзі', false);
    else if (!delivered && !busy) {
      // Якщо якась платформа чекає, повертаємось до черги, щойно очікування мине (один будильник, без опитування D1).
      const waiting = gates.platforms.length > 0 || gates.paced.length > 0;
      notes.push(waiting
        ? `видача: решту черги стримують ${[...gates.platforms, ...gates.paced.map((platform) => `${platform} (інтервал)`)].join(', ')} до ${new Date(gates.until).toISOString()} (runner: ${runners})`
        : `видача: у черзі на сьогодні нічого не лишилось (runner: ${runners})`);
      if (!waiting) await this.finishAutopostBatches(state);
    }
    flush();
    state.autopostWatchAt = gates.platforms.length || gates.paced.length ? gates.until + 1000 : undefined;
    await this.scheduleAlarm(state);
  }

  /**
   * Які платформи зараз не видаються: пауза за проханням runner і Telegram до кінця інтервалу між публікаціями.
   * Закінчені паузи прибираються. `until` — найближчий кінець очікування (мс), за яким DO сам повертається до черги.
   * @param {OwnerChannelState} state
   * @param {number} now
   * @returns {{platforms: string[], until: number, paceTelegram: boolean}}
   */
  autopostGates(state, now) {
    /** @type {string[]} */
    const platforms = [];
    /** @type {string[]} */
    const paced = [];
    let until = Infinity;
    for (const platform of AUTOPOST_PLATFORMS) {
      let end = state.autopostPaused?.[platform] ?? 0;
      if (end && end <= now) { delete state.autopostPaused?.[platform]; end = 0; }
      if (end > now) { platforms.push(platform); until = Math.min(until, end); }
      // Інтервал «N на годину» стримує лише відправки платформи: проходи «знайти гілки» й перевірки під час нього видаються.
      const nextAt = state.autopostPace?.[platform]?.nextAt ?? 0;
      if (nextAt > now && !platforms.includes(platform)) { paced.push(platform); until = Math.min(until, nextAt); }
    }
    return { platforms, until, paced };
  }

  /** Інтервал між відправками платформи (с): 0 — без пауз. */
  paceInterval(state, platform) {
    return state.autopostPace?.[platform]?.intervalSeconds ?? defaultIntervalSeconds(platform);
  }

  /** Короткий опис задач у роботі для журналу. */
  lanesText(state) {
    const jobs = AUTOPOST_LANES.map((lane) => state.autopostLanes?.[lane]?.jobId).filter(Boolean);
    return jobs.length ? jobs.join(', ') : 'нічого';
  }

  /** Канал, у якому зараз виконується задача (або null). */
  laneOfJob(state, jobId) {
    for (const lane of AUTOPOST_LANES) if (state.autopostLanes?.[lane]?.jobId === jobId) return lane;
    return null;
  }

  /** @param {OwnerChannelState} state @param {string} platform */
  broadcastPace(state, platform) {
    const pace = state.autopostPace?.[platform];
    if (!pace) return;
    this.broadcast('browser', { type: 'progress', process: 'autopost_pace', platform, nextAt: pace.nextAt, intervalSeconds: pace.intervalSeconds });
  }

  /**
   * Чи можна забути задачу, яку DO вважає «в роботі». Розгортання обриває з'єднання з runner без
   * webSocketClose, runner перепідключається чистим, а поле лишається — і видача стоїть назавжди
   * (2026-10-18: Viber і WhatsApp не стартували кілька годин). Задачу, що вже не `claimed`, просто
   * забуваємо; `claimed` довше за AUTOPOST_LEASE_SECONDS (один чат — 15–30 с) повертаємо в чергу.
   * @param {OwnerChannelState} state
   * @param {string} lane канал видачі
   * @returns {Promise<boolean>} true — поле очищено, можна видавати наступну
   */
  async forgetStaleAutopostJob(state, lane) {
    const jobId = state.autopostLanes?.[lane]?.jobId;
    if (!jobId || !state.userId) return true;
    const row = await this.env.DB.prepare('SELECT status,updated_at FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1')
      .bind(jobId, state.userId).first();
    if (row && row.status === 'claimed') {
      const age = nowSeconds() - Number(row.updated_at || 0);
      if (age < AUTOPOST_LEASE_SECONDS) return false;
      await releaseWhatsAppAutopostJob(this.env.DB, state.userId, jobId, nowSeconds());
      this.autopostTrace(state, `оренда: задачу ${jobId} повернуто в чергу після ${age} с без відповіді`);
      this.broadcast('runner', { type: 'cancel', process: 'autopost', jobId });
      this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId, status: 'released' });
    } else {
      this.autopostTrace(state, `оренда: задача ${jobId} вже ${row ? row.status : 'видалена'}, забуто`);
    }
    if (state.autopostLanes) state.autopostLanes[lane] = undefined;
    return true;
  }

  /**
   * Чи задача досі `claimed` у D1. Результат і повернення від runner приймаємо за цим, а не за полем DO: після обриву зв'язку
   * runner звітує вже з нового з'єднання, а поле могло бути очищене.
   * @param {string} userId
   * @param {string} jobId
   */
  async isClaimedAutopostJob(userId, jobId) {
    if (typeof jobId !== 'string' || !jobId) return false;
    const row = await this.env.DB.prepare('SELECT status FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1').bind(jobId, userId).first();
    return Boolean(row && row.status === 'claimed');
  }

  /** @param {{jobId:string; status:string; observedTarget?:string; targetVerified?:boolean; sendConfirmed?:boolean; sendAttempted?:boolean; errorCode?:string}} message */
  async handleAutopostResult(message) {
    const state = await this.readState();
    if (!state.userId) return;
    const lane = this.laneOfJob(state, message.jobId);
    if (!lane && !(await this.isClaimedAutopostJob(state.userId, message.jobId))) {
      // Результат для задачі, якої вже немає в роботі, нічого не змінює; лишається слід, бо «sent» тут означав би публікацію без запису.
      this.autopostTrace(state, `результат: ${message.status}${message.errorCode ? ` (${message.errorCode})` : ''} для ${message.jobId} проігноровано, у роботі ${this.lanesText(state)}`, false);
      await this.writeState(state);
      return;
    }
    const slot = lane ? state.autopostLanes?.[lane] : undefined;
    if (lane && state.autopostLanes) state.autopostLanes[lane] = undefined;
    // Наступна відправка платформи не раніше, ніж через її інтервал від початку цієї: рівномірно, без пачок навіть після затримки. Задача,
    // що завершилась до натискання «Надіслати» (збій, проходи, перевірки), вікна не займає: наступна видається одразу.
    const eventPlatform = slot?.current.platform;
    const interval = eventPlatform ? this.paceInterval(state, eventPlatform) * 1000 : 0;
    if (slot?.current.send && interval > 0 && (message.sendAttempted === true || message.status === 'sent')) {
      state.autopostPace = { ...(state.autopostPace || {}), [eventPlatform]: { intervalSeconds: interval / 1000, nextAt: Math.max(slot.current.startedAt + interval, Date.now()) } };
      this.broadcastPace(state, eventPlatform);
    }
    let status = 'failed';
    try {
      const outcome = await completeWhatsAppAutopostJob(this.env.DB, state.userId, message, nowSeconds());
      status = (outcome && typeof outcome.status === 'string') ? outcome.status : 'failed';
    } catch {
      // job already resolved another way (e.g. operator cancel) — nothing left to apply
    }
    this.autopostTrace(state, `результат: ${message.status}${message.errorCode ? ` (${message.errorCode})` : ''} для ${message.jobId} → ${status}`, false);
    // Sent before the next dispatch so a browser sees this job finish before the next one starts;
    // either way it reloads its queue, which is where the authoritative job status lives.
    this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: message.jobId, status, ...(eventPlatform ? { platform: eventPlatform } : {}) });
    await this.dispatchNextAutopostJob(state);
    await this.writeState(state);
  }

  /**
   * Runner щойно підключився й назвав задачі автопосту, які в нього в роботі. Задачі каналів, видані ДО цього підключення й невідомі runner,
   * до нього не дійшли (сокет був мертвий): повертаємо їх у чергу й видаємо знову.
   * @param {string[]} active
   */
  async handleRunnerState(active) {
    const state = await this.readState();
    if (!state.userId) return;
    let released = 0;
    for (const lane of AUTOPOST_LANES) {
      const slot = state.autopostLanes?.[lane];
      if (!slot?.jobId || active.includes(slot.jobId) || slot.claimedAt >= (state.runnerConnectedAt ?? 0)) continue;
      await releaseWhatsAppAutopostJob(this.env.DB, state.userId, slot.jobId, nowSeconds());
      this.autopostTrace(state, `runner не знає задачу ${slot.jobId} (канал ${lane}): повернено в чергу`);
      this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: slot.jobId, status: 'released', platform: slot.current.platform });
      state.autopostLanes[lane] = undefined;
      released += 1;
    }
    if (released) await this.dispatchNextAutopostJob(state);
    await this.writeState(state);
  }

  /** @param {{jobId:string; errorCode?:string; until?:number; platform?:string}} message */
  async handleAutopostRelease(message) {
    const state = await this.readState();
    if (!state.userId) return;
    const releasedLane = this.laneOfJob(state, message.jobId);
    if (!releasedLane && !(await this.isClaimedAutopostJob(state.userId, message.jobId))) {
      this.autopostTrace(state, `повернення: ${message.jobId} проігноровано, у роботі ${this.lanesText(state)}`, false);
      await this.writeState(state);
      return;
    }
    // Код приходить лише від тимчасової помилки самої задачі: сервер рахує спробу й після третьої пропускає чат на сьогодні.
    await releaseWhatsAppAutopostJob(this.env.DB, state.userId, message.jobId, nowSeconds(),
      typeof message.errorCode === 'string' ? message.errorCode : undefined);
    const releasedPlatform = releasedLane ? state.autopostLanes?.[releasedLane]?.current.platform : undefined;
    if (releasedLane && state.autopostLanes) state.autopostLanes[releasedLane] = undefined;
    this.autopostTrace(state, `повернення: ${message.jobId} назад у чергу${message.errorCode ? ` (${message.errorCode})` : ' (середовище не готове)'}`, false);
    // Runner просить паузу до певного часу: до нього не видаємо задач і не будимо себе раніше (не довше за годину).
    const until = Number(message.until);
    const platform = AUTOPOST_PLATFORMS.includes(String(message.platform)) ? String(message.platform) : 'whatsapp';
    if (Number.isFinite(until) && until > Date.now()) {
      // FloodWait у Telegram може бути на години; решті платформ вистачає години.
      const capped = Math.min(until, Date.now() + (platform === 'telegram' ? 24 : 1) * 3_600_000);
      state.autopostPaused = { ...(state.autopostPaused || {}), [platform]: capped };
      // Пауза платформи зсуває й її вікно інтервалу: після FloodWait наступна відправка не раніше кінця паузи.
      const pace = state.autopostPace?.[platform];
      if (platform === 'telegram' && pace) { pace.nextAt = Math.max(pace.nextAt, capped); this.broadcastPace(state, platform); }
    }
    const gate = this.autopostGates(state, Date.now());
    state.autopostWatchAt = gate.platforms.length ? gate.until + 1000 : Date.now() + AUTOPOST_WATCH_MS;
    await this.scheduleAlarm(state);
    await this.writeState(state);
    this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId: message.jobId, status: 'released', ...(releasedPlatform ? { platform: releasedPlatform } : {}) });
  }

  /** @param {WebSocket} _ws */
  async handleAutopostReady(_ws) {
    const state = await this.readState();
    this.autopostTrace(state, 'runner просить наступну задачу', false);
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
  webSocketClose(ws, _code, _reason, _wasClean) {
    return this.serial(() => this.handleSocketClose(ws));
  }

  /** @param {WebSocket} ws */
  async handleSocketClose(ws) {
    // Complete the close handshake from our side too (harmless if it is already closed).
    try { ws.close(1000, 'closed'); } catch { /* already closed */ }
    if (this.tagsOf(ws).includes('runner') && this.openRunnerCount(ws) === 0) {
      const state = await this.readState();
      await this.markRunnerOffline(state, nowSeconds());
      await this.writeState(state);
    }
  }

  // Alarm: re-check runner liveness by ping times while a runner is believed connected.
  alarm() {
    return this.serial(() => this.handleAlarm());
  }

  async handleAlarm() {
    const state = await this.readState();
    if (state.runnerOnline && this.openRunnerCount() === 0) await this.markRunnerOffline(state);
    if (state.discoveryRunWakeAt && state.discoveryRunWakeAt <= Date.now()) {
      state.discoveryRunWakeAt = null;
      await this.dispatchRun(state);
    }
    if (state.autopostWatchAt && Date.now() >= state.autopostWatchAt) {
      state.autopostWatchAt = undefined;
      this.autopostTrace(state, 'будильник: перевіряю чергу автопосту після повернення задачі');
      await this.dispatchNextAutopostJob(state);
    }
    if (AUTOPOST_LANES.some((lane) => { const slot = state.autopostLanes?.[lane]; return slot?.jobId && Date.now() >= slot.claimedAt + AUTOPOST_LEASE_SECONDS * 1000; })) {
      this.autopostTrace(state, `будильник: оренда задачі ${this.lanesText(state)} спливла, перевіряю чергу`);
      await this.dispatchNextAutopostJob(state);
    }
    await this.checkPushWatches(state);
    await this.scheduleAlarm(state);
    await this.writeState(state);
  }

  /**
   * Сповіщення на телефон власнику. Тиха година й ліміт «одна причина раз на 30 хв» тут, щоб жоден виклик їх не обійшов.
   * @param {OwnerChannelState} state
   * @param {string} reason
   * @param {{title: string, body: string, url: string, tag?: string}} payload
   */
  async notifyOwner(state, reason, payload) {
    const privateKey = this.env.VAPID_PRIVATE_KEY;
    if (!state.userId || !privateKey) return false;
    const now = Date.now();
    const hour = kyivHour(now);
    if (hour >= 22 || hour < 8) return false;
    state.pushSentAt ??= {};
    if (now - (state.pushSentAt[reason] ?? 0) < PUSH_REASON_GAP_MS) return false;
    state.pushSentAt[reason] = now;
    try {
      const delivered = await pushToOwner(this.env.DB, privateKey, state.userId, payload, nowSeconds());
      this.autopostTrace(state, `сповіщення «${payload.title}»: доставлено на ${delivered} пристроїв`, false);
    } catch (error) {
      this.autopostTrace(state, `сповіщення «${payload.title}» не надіслано: ${error instanceof Error ? error.message : String(error)}`, false);
    }
    return true;
  }

  /**
   * Остання ознака життя партії платформи: відкриття задачі, крок із runner або кінець очікування інтервалу (очікування між публікаціями
   * не є збоєм).
   * @param {OwnerChannelState} state
   * @param {string} platform
   */
  autopostLastActivity(state, platform) {
    /** @type {Record<string, number>} */
    const steps = (this.stepAt ??= {});
    return Math.max(state.autopostBatchOpen?.[platform] ?? 0, steps[platform] ?? 0, state.autopostPace?.[platform]?.nextAt ?? 0);
  }

  /** @param {OwnerChannelState} state */
  async checkPushWatches(state) {
    const now = Date.now();
    if (state.runnerOfflineAt && !state.runnerOnline && this.openRunnerCount() === 0 && now >= state.runnerOfflineAt + PUSH_RUNNER_OFFLINE_MS) {
      await this.notifyOwner(state, 'runner_offline', { title: 'Runner вимкнений', body: 'ПК не підключений уже понад 10 хв, автопост не працює.', url: '/?go=today', tag: 'runner-offline' });
    }
    for (const platform of Object.keys(state.autopostBatchOpen ?? {})) {
      if (now - this.autopostLastActivity(state, platform) < PUSH_AUTOPOST_STALL_MS) continue;
      await this.notifyOwner(state, `stall:${platform}`, { title: `${PUSH_PLATFORM_NAMES[platform] ?? platform}: партія стоїть`, body: 'Понад 15 хв без жодного кроку.', url: `/?go=platforms:${platform}:autopost`, tag: `stall-${platform}` });
    }
  }

  /**
   * Черга на сьогодні спорожніла: для кожної платформи з відкритою партією один підсумок («Viber: 74 з 79, 5 потребують рішення»).
   * @param {OwnerChannelState} state
   */
  async finishAutopostBatches(state) {
    const open = Object.keys(state.autopostBatchOpen ?? {});
    state.autopostBatchOpen = undefined;
    if (!state.userId) return;
    for (const platform of open) {
      try {
        const progress = await readWhatsAppAutopostProgress(this.env.DB, state.userId, businessDate(nowSeconds()), platform, null);
        const batch = progress.batch;
        if (!batch?.total) continue;
        const decision = progress.settled?.decision || 0;
        await this.notifyOwner(state, `batch:${platform}`, {
          title: `${PUSH_PLATFORM_NAMES[platform] ?? platform}: ${batch.sent} з ${batch.total}${decision ? `, ${decision} потребують рішення` : ''}`,
          body: 'Партія автопосту завершена.', url: `/?go=platforms:${platform}:autopost`, tag: `batch-${platform}`,
        });
      } catch (error) {
        this.autopostTrace(state, `підсумок партії ${platform} не прочитано: ${error instanceof Error ? error.message : String(error)}`, false);
      }
    }
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
    // Задача автопосту «в роботі» не чекає чужої події: коли оренда спливає, DO сам прокидається й видає наступну. Один будильник на задачу, не опитування.
    for (const lane of AUTOPOST_LANES) { const slot = state.autopostLanes?.[lane]; if (slot?.jobId) times.push(slot.claimedAt + AUTOPOST_LEASE_SECONDS * 1000 + 2000); }
    if (state.autopostWatchAt) times.push(Math.max(state.autopostWatchAt, Date.now() + 1000));
    // Сповіщення: runner офлайн понад 10 хв і партія без кроків понад 15 хв (одні будильники, без опитувань).
    if (state.runnerOfflineAt && !state.runnerOnline) times.push(Math.max(state.runnerOfflineAt + PUSH_RUNNER_OFFLINE_MS, Date.now() + 1000));
    for (const platform of Object.keys(state.autopostBatchOpen ?? {})) times.push(Math.max(this.autopostLastActivity(state, platform) + PUSH_AUTOPOST_STALL_MS + 1000, Date.now() + 1000));
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
    state.runnerOfflineAt ??= Date.now();
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
    if (state.userId) {
      // Не лише задача, яку DO пам'ятає: рядок `claimed` у D1 без відкритого runner нікому не належить, хоч би що лежало в стані.
      const released = await releaseClaimedAutopostJobs(this.env.DB, state.userId, nowSeconds());
      for (const lane of AUTOPOST_LANES) { const known = state.autopostLanes?.[lane]?.jobId; if (known && !released.includes(known)) released.push(known); }
      for (const jobId of released) this.broadcast('browser', { type: 'process_state', process: 'autopost', jobId, status: 'released' });
      if (released.length) this.autopostTrace(state, `runner відсутній: повернено в чергу ${released.length} задач (${released.join(', ')})`, false);
    }
    state.autopostLanes = {};
    state.viberStatus = undefined;
    state.autopostStatus = undefined;
    state.autopostPaused = undefined;
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
  webSocketError(ws, _error) {
    return this.serial(() => this.handleSocketClose(ws));
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
   * @returns {number} скільки сокетів прийняли повідомлення
   */
  broadcast(kind, message) {
    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets(kind)) {
      try { socket.send(payload); delivered += 1; } catch { /* socket closing concurrently; next close event cleans up */ }
    }
    return delivered;
  }

  /** @returns {Promise<OwnerChannelState>} */
  async readState() {
    const stored = await this.ctx.storage.get(STORAGE_KEY);
    const state = stored ?? { userId: null, processes: {}, waitingCheckBatch: null, autopostLanes: {}, discoveryCurrentTask: null, runnerLastSeenAt: null, runnerOnline: false };
    // Стан, записаний до каналів видачі (одна задача в роботі): переносимо в канал браузера, Telegram-інтервал — у спільну мапу.
    if (state.autopostCurrentJobId) {
      state.autopostLanes = { ...(state.autopostLanes || {}), browser: { jobId: state.autopostCurrentJobId, claimedAt: state.autopostClaimedAt ?? Date.now(), current: { send: Boolean(state.autopostCurrent?.telegramSend), startedAt: state.autopostCurrent?.startedAt ?? Date.now(), platform: state.autopostCurrent?.platform ?? 'whatsapp' } } };
    }
    state.autopostCurrentJobId = null;
    state.autopostClaimedAt = undefined;
    state.autopostCurrent = undefined;
    if (state.telegramPace && !state.autopostPace?.telegram) state.autopostPace = { ...(state.autopostPace || {}), telegram: state.telegramPace };
    state.telegramPace = undefined;
    return state;
  }

  /** @param {OwnerChannelState} state */
  async writeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }
}
