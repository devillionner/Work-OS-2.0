// Browser side of the owner live channel (/api/live?kind=browser → workers/owner-channel.js). One
// WebSocket per page, shared by every subscriber and opened only while at least one is subscribed.
// Receive-only: commands (start/stop of waiting_check, autopost jobs) keep going through their normal
// HTTP routes, which already bridge into the same Durable Object.
//
// The channel only knows about runner processes (waiting_check, autopost, discovery, runner online
// state) — not arbitrary mutations like leads or reports. Callers treat any message as "something
// changed, check once" and keep their own fallback for everything else.

export type LiveMessage = { type: string; [key: string]: unknown };
export type LiveStatus = { connected: boolean; runnerConnected: boolean | null };

type MessageListener = (message: LiveMessage) => void;
type StatusListener = (status: LiveStatus) => void;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Cloudflare closes a WebSocket after 100 s without traffic. This exact string is the owner DO's
// hibernation auto-response pair, so a keepalive never wakes the DO or runs any of its code.
const KEEPALIVE_MS = 30_000;
const KEEPALIVE_TIMEOUT_MS = 10_000;
const PING = JSON.stringify({ type: 'ping' });

const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<StatusListener>();
let status: LiveStatus = { connected: false, runnerConnected: null };
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let windowListenersAttached = false;

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
  if (merged.connected === status.connected && merged.runnerConnected === status.runnerConnected) return;
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
    setStatus({ connected: false, runnerConnected: null });
    scheduleReconnect();
  };
  ws.addEventListener('open', () => {
    reconnectDelay = RECONNECT_MIN_MS;
    setStatus({ connected: true });
    clearKeepalive();
    scheduleKeepalive(ws);
  });
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let message: LiveMessage;
    try { message = JSON.parse(event.data) as LiveMessage; } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'pong') {
      if (pongTimer !== null) { clearTimeout(pongTimer); pongTimer = null; }
      return;
    }
    if (message.type === 'hello' && typeof message.runnerConnected === 'boolean') setStatus({ runnerConnected: message.runnerConnected });
    if (message.type === 'runner_status' && typeof message.connected === 'boolean') setStatus({ runnerConnected: message.connected });
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

function attachWindowListeners() {
  if (windowListenersAttached) return;
  windowListenersAttached = true;
  window.addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', retryNow);
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
  status = { connected: false, runnerConnected: null };
  if (ws) { try { ws.close(1000, 'unused'); } catch { /* already closed */ } }
}
