// Browser side of the owner live channel (/api/live?kind=browser → workers/owner-channel.js). One
// WebSocket per page, shared by every subscriber and opened only while at least one is subscribed.
// Receive-only: commands (start/stop of waiting_check, autopost jobs) keep going through their normal
// HTTP routes, which already bridge into the same Durable Object.
//
// The channel only knows about runner processes (waiting_check, autopost, discovery, runner online
// state) — not arbitrary mutations like leads or reports. Callers treat any message as "something
// changed, check once" and keep their own fallback for everything else.

export type LiveMessage = { type: string; [key: string]: unknown };
/** `synced` — на цьому сокеті вже прийшов hello зі знімком стану (крок, темп, статус); поки його немає, картки пишуть «Оновлюю…». */
export type LiveStatus = { connected: boolean; runnerConnected: boolean | null; runnerVersion?: string; synced?: boolean };

type MessageListener = (message: LiveMessage) => void;
type StatusListener = (status: LiveStatus) => void;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Cloudflare closes a WebSocket after 100 s without traffic. This exact string is the owner DO's
// hibernation auto-response pair, so a keepalive never wakes the DO or runs any of its code.
const KEEPALIVE_MS = 30_000;
const KEEPALIVE_TIMEOUT_MS = 10_000;
// Повернення на вкладку (iPhone приспав її, ноутбук прокинувся): сокет, що мовчав довше за цей час, перевіряється пінгом, і якщо
// відповіді немає за RESUME_PROBE_MS, одразу перепідключається, не чекаючи таймера.
const RESUME_QUIET_MS = 5_000;
const RESUME_PROBE_MS = 1_500;
const CONNECTING_STUCK_MS = 6_000;
const PING = JSON.stringify({ type: 'ping' });

const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<StatusListener>();
let status: LiveStatus = { connected: false, runnerConnected: null, synced: false };
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let lastActivityAt = 0;
let connectStartedAt = 0;
let helloSeen = false;
let windowListenersAttached = false;
// Поки вкладка прихована, повідомлення не доходять до підписників (вони б перечитували дані з бази, а ніхто не дивиться): кеші статусів
// оновлюються, а на поверненні підписники отримують одне синтетичне `hello` з `resync` (і `deferred`, щоб ServerSync не дублював власну перевірку).
let deferredWhileHidden = false;
let runnerCheckPending = false;
let lastRunnerCheckAt = 0;
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Просить runner один раз перевірити середовище (власник відкрив картку автопосту); у простої runner інакше мовчить. */
export function requestRunnerCheck() {
  const now = Date.now();
  if (now - lastRunnerCheckAt < 60_000) return;
  lastRunnerCheckAt = now;
  if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ type: 'check_status' })); } catch { /* наступне відкриття картки спробує знову */ } }
  else runnerCheckPending = true;
}

function flushDeferred() {
  if (!deferredWhileHidden || isHidden()) return;
  deferredWhileHidden = false;
  const message: LiveMessage = { type: 'hello', resync: true, deferred: true };
  for (const listener of messageListeners) listener(message);
}
// Останній стан Viber від runner: приходить у hello і щохвилини; сторінка, відкрита між повідомленнями, бере його звідси, а не чекає наступного.
let latestViberStatus: LiveMessage | null = null;
export function getLatestViberStatus(): LiveMessage | null { return latestViberStatus; }
/** Стан автопосту WhatsApp і Telegram від runner (пауза з причиною): приходить у hello і при кожній зміні. */
export type AutopostPlatformStatus = { state: 'ready' | 'blocked'; reason: string | null; text: string; until: number | null; /** Telegram: id акаунта, залогіненого в браузері runner. */ identity: string | null };
let latestAutopostStatus: Record<string, AutopostPlatformStatus> = {};
/** Коли DO видасть наступну відправку платформи і з яким інтервалом: приходить у hello і щоразу, як змінюється. */
export type AutopostPace = { nextAt: number; intervalSeconds: number };
export type TelegramPace = AutopostPace;
let latestPace: Record<string, AutopostPace> = {};
/** Несрочні повідомлення runner для карток (код → текст), наприклад «Перезапусти Opera». */
let runnerNotices: Record<string, string> = {};
/** Що runner робить просто зараз за платформами: приходить у hello (знімок DO) і подіями `autopost_step`. */
export type AutopostStep = { jobId: string; name: string; text: string; startedAt: number; at: number; verify: boolean };
let latestSteps: Record<string, AutopostStep> = {};
export function getLatestStep(platform: string): AutopostStep | null { return latestSteps[platform] || null; }
function cleanStep(value: unknown): AutopostStep | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return { jobId: String(item.jobId || ''), name: String(item.name || ''), text: String(item.text || ''), startedAt: Number(item.startedAt) || Date.now(), at: Number(item.at) || Date.now(), verify: item.verify === true };
}
export function getRunnerNotice(code: string): string | null { return runnerNotices[code] || null; }
export function getLatestPace(platform: string): AutopostPace | null { return latestPace[platform] || null; }
export function getLatestTelegramPace(): AutopostPace | null { return getLatestPace('telegram'); }
function cleanTelegramPace(value: unknown): TelegramPace | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return typeof item.nextAt === 'number' && typeof item.intervalSeconds === 'number' && item.intervalSeconds > 0 ? { nextAt: item.nextAt, intervalSeconds: item.intervalSeconds } : null;
}
export function getLatestAutopostStatus(platform: string): AutopostPlatformStatus | null { return latestAutopostStatus[platform] || null; }
function cleanAutopostStatus(value: unknown): AutopostPlatformStatus | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return { state: item.state === 'ready' ? 'ready' : 'blocked', reason: typeof item.reason === 'string' ? item.reason : null, text: typeof item.text === 'string' ? item.text : '', until: typeof item.until === 'number' && item.until > 0 ? item.until : null, identity: typeof item.identity === 'string' && /^[0-9]{3,20}$/.test(item.identity) ? item.identity : null };
}

export function subscribeLiveMessages(listener: MessageListener): () => void {
  messageListeners.add(listener);
  ensureConnected();
  return () => { messageListeners.delete(listener); disconnectIfUnused(); };
}

/** Calls the listener immediately with the current status, then on every change. */
export function subscribeLiveStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(status);
  ensureConnected();
  return () => { statusListeners.delete(listener); disconnectIfUnused(); };
}

function hasSubscribers() {
  return messageListeners.size > 0 || statusListeners.size > 0;
}

function setStatus(next: Partial<LiveStatus>) {
  const merged = { ...status, ...next };
  if (merged.connected === status.connected && merged.runnerConnected === status.runnerConnected && merged.runnerVersion === status.runnerVersion && merged.synced === status.synced) return;
  status = merged;
  for (const listener of statusListeners) listener(status);
}

function ensureConnected() {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  attachWindowListeners();
  if (socket || reconnectTimer !== null) return;
  connect();
}

function connect() {
  reconnectTimer = null;
  if (!hasSubscribers()) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws: WebSocket;
  try { ws = new WebSocket(`${protocol}//${window.location.host}/api/live?kind=browser`); }
  catch { scheduleReconnect(); return; }
  socket = ws;
  connectStartedAt = Date.now();

  // A rejected handshake (401, network refused) may fire only 'error' and never 'close' — the runner
  // hit exactly that in Node (commit 3e). Reconnect from both, guarded so a socket that fires both
  // reconnects once.
  let settled = false;
  const onDown = () => {
    if (settled) return;
    settled = true;
    // A socket already abandoned by disconnectIfUnused must not touch the state of a newer one.
    if (socket !== ws) return;
    socket = null;
    clearKeepalive();
    try { ws.close(); } catch { /* already closed */ }
    setStatus({ connected: false, runnerConnected: null, synced: false });
    scheduleReconnect();
  };
  ws.addEventListener('open', () => {
    reconnectDelay = RECONNECT_MIN_MS;
    lastActivityAt = Date.now();
    setStatus({ connected: true });
    if (runnerCheckPending) { runnerCheckPending = false; try { ws.send(JSON.stringify({ type: 'check_status' })); } catch { /* ignore */ } }
    clearKeepalive();
    scheduleKeepalive(ws);
  });
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let message: LiveMessage;
    try { message = JSON.parse(event.data) as LiveMessage; } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    lastActivityAt = Date.now();
    if (message.type === 'pong') {
      if (pongTimer !== null) { clearTimeout(pongTimer); pongTimer = null; }
      return;
    }
    if (message.type === 'hello') {
      latestSteps = {};
      const all = message.autopostSteps && typeof message.autopostSteps === 'object' ? message.autopostSteps as Record<string, unknown> : {};
      for (const [platform, value] of Object.entries(all)) { const clean = cleanStep(value); if (clean) latestSteps[platform] = clean; }
      // hello після перепідключення (а не перший на сторінці): картки один раз перечитують прогрес партії.
      if (helloSeen) message = { ...message, resync: true };
      helloSeen = true;
      setStatus({ synced: true });
    }
    if (message.type === 'progress' && message.process === 'autopost_step' && typeof message.platform === 'string') {
      const clean = cleanStep(message);
      if (clean) latestSteps = { ...latestSteps, [message.platform]: clean };
    }
    if (message.type === 'hello' && typeof message.runnerConnected === 'boolean') setStatus({ runnerConnected: message.runnerConnected, ...(typeof message.runnerVersion === 'string' ? { runnerVersion: message.runnerVersion } : {}) });
    if (message.type === 'hello' && message.viberStatus && typeof message.viberStatus === 'object') latestViberStatus = { type: 'progress', process: 'viber_status', ...(message.viberStatus as Record<string, unknown>) };
    if (message.type === 'progress' && message.process === 'viber_status') latestViberStatus = message;
    if (message.type === 'hello' && message.autopostStatus && typeof message.autopostStatus === 'object') {
      latestAutopostStatus = {};
      for (const [platform, value] of Object.entries(message.autopostStatus as Record<string, unknown>)) { const clean = cleanAutopostStatus(value); if (clean) latestAutopostStatus[platform] = clean; }
    }
    if (message.type === 'hello') {
      latestPace = {};
      const all = message.autopostPace && typeof message.autopostPace === 'object' ? message.autopostPace as Record<string, unknown> : {};
      for (const [platform, value] of Object.entries(all)) { const clean = cleanTelegramPace(value); if (clean) latestPace[platform] = clean; }
    }
    if (message.type === 'progress' && message.process === 'autopost_pace' && typeof message.platform === 'string') {
      const clean = cleanTelegramPace(message);
      latestPace = clean ? { ...latestPace, [message.platform]: clean } : Object.fromEntries(Object.entries(latestPace).filter(([key]) => key !== message.platform));
    }
    if (message.type === 'progress' && message.process === 'autopost_status' && typeof message.platform === 'string') {
      const clean = cleanAutopostStatus(message);
      if (clean) latestAutopostStatus = { ...latestAutopostStatus, [message.platform]: clean };
    }
    if (message.type === 'hello') {
      const raw = message.runnerNotices;
      runnerNotices = raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
    }
    if (message.type === 'progress' && message.process === 'runner_notice' && typeof message.code === 'string') {
      const { [message.code]: _gone, ...rest } = runnerNotices;
      runnerNotices = message.active === true && typeof message.text === 'string' && message.text ? { ...rest, [message.code]: message.text } : rest;
    }
    if (message.type === 'runner_status' && typeof message.connected === 'boolean') { setStatus({ runnerConnected: message.connected, ...(typeof message.version === 'string' ? { runnerVersion: message.version } : {}) }); if (!message.connected) { latestViberStatus = null; latestAutopostStatus = {}; runnerNotices = {}; latestSteps = {}; } }
    if (isHidden()) { deferredWhileHidden = true; return; }
    for (const listener of messageListeners) listener(message);
  });
  ws.addEventListener('close', onDown);
  ws.addEventListener('error', onDown);
}

function scheduleKeepalive(ws: WebSocket) {
  if (keepaliveTimer !== null) clearTimeout(keepaliveTimer);
  keepaliveTimer = setTimeout(() => {
    keepaliveTimer = null;
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(PING); } catch { ws.dispatchEvent(new Event('error')); return; }
    // No pong means a half-open socket (laptop sleep, network switch): drop it and reconnect instead
    // of believing the channel is live while nothing can arrive.
    pongTimer = setTimeout(() => { pongTimer = null; ws.dispatchEvent(new Event('error')); }, KEEPALIVE_TIMEOUT_MS);
    scheduleKeepalive(ws);
  }, KEEPALIVE_MS);
}

function clearKeepalive() {
  if (keepaliveTimer !== null) { clearTimeout(keepaliveTimer); keepaliveTimer = null; }
  if (pongTimer !== null) { clearTimeout(pongTimer); pongTimer = null; }
}

function scheduleReconnect() {
  if (!hasSubscribers() || reconnectTimer !== null) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
  reconnectTimer = setTimeout(connect, delay);
}

// Coming back online or to a visible tab retries right away instead of waiting out a long backoff.
function retryNow() {
  if (!hasSubscribers() || socket) return;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectDelay = RECONNECT_MIN_MS;
  connect();
}

/**
 * Повернення на вкладку (visible, focus, pageshow, online): iPhone приспав сторінку, і сокет міг тихо померти, а подій більше не
 * буде. Мертвий сокет скидається одразу; сокет, що мовчав, перевіряється пінгом і при мовчанні понад RESUME_PROBE_MS теж скидається.
 * Нове з'єднання отримує hello зі знімком стану, тож картки не чекають наступної події runner.
 */
function checkConnection() {
  if (!hasSubscribers() || typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  const ws = socket;
  if (!ws) { retryNow(); return; }
  if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) { ws.dispatchEvent(new Event('error')); retryNow(); return; }
  if (ws.readyState === WebSocket.CONNECTING) {
    if (Date.now() - connectStartedAt > CONNECTING_STUCK_MS) { ws.dispatchEvent(new Event('error')); retryNow(); }
    return;
  }
  if (Date.now() - lastActivityAt < RESUME_QUIET_MS || pongTimer !== null) return;
  try { ws.send(PING); } catch { ws.dispatchEvent(new Event('error')); retryNow(); return; }
  // Мовчання після повернення означає мертвий сокет: скидаємо його й підключаємось одразу, без паузи відкату.
  pongTimer = setTimeout(() => { pongTimer = null; ws.dispatchEvent(new Event('error')); retryNow(); }, RESUME_PROBE_MS);
}

function attachWindowListeners() {
  if (windowListenersAttached) return;
  windowListenersAttached = true;
  window.addEventListener('online', checkConnection);
  window.addEventListener('focus', checkConnection);
  window.addEventListener('pageshow', checkConnection);
  document.addEventListener('visibilitychange', checkConnection);
  document.addEventListener('visibilitychange', flushDeferred);
}

// Deferred one tick so an unmount immediately followed by a remount (React StrictMode, a component
// moving in the tree) keeps the same socket instead of tearing it down mid-handshake.
function disconnectIfUnused() {
  setTimeout(() => { if (!hasSubscribers()) disconnect(); }, 0);
}

function disconnect() {
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  clearKeepalive();
  const ws = socket;
  socket = null;
  reconnectDelay = RECONNECT_MIN_MS;
  status = { connected: false, runnerConnected: null, synced: false };
  helloSeen = false;
  if (ws) { try { ws.close(1000, 'unused'); } catch { /* already closed */ } }
}
