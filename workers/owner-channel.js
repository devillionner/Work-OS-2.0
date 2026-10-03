// Durable Object: one instance per owner (idFromName(userId)), reached only through
// app/api/live/route.ts (which has already authenticated the connection — this class trusts
// its caller and does no auth of its own). Holds live process state in ctx.storage and relays
// commands/progress between the browser and the local runner over Hibernatable WebSockets, so
// neither side has to poll D1 to find out what the other is doing.
//
// D1 keeps only durable facts (chats, publications, qualification outcomes); "who is running,
// who owns the current task" lives here instead of the old time-limited lease/fencing columns —
// an open WebSocket connection *is* the ownership proof, so there is nothing to expire.
//
// Plain JS, not TypeScript: vinext builds with Wrangler's "no_bundle" mode, which uploads
// dist/server/*.js as separate ES modules without a bundling step, so this file (copied
// alongside worker-entry.js at build time — see scripts/normalize-wrangler-config.mjs) must
// already be plain, runnable JavaScript. Tests cover the message-routing/storage behavior
// directly (tests/owner-channel.test.mjs); IDE type hints come from the JSDoc below.

/** @typedef {'browser'|'runner'} ChannelKind */
/** @typedef {'waiting_check'|'autopost'|'discovery'} ProcessName */
/** @typedef {{running: boolean, params: unknown, updatedAt: number}} ProcessState */

const STORAGE_KEY = 'state';
const PING = JSON.stringify({ type: 'ping' });
const PONG = JSON.stringify({ type: 'pong' });

export class OwnerChannel {
  /**
   * @param {DurableObjectState} ctx
   * @param {Cloudflare.Env} _env
   */
  constructor(ctx, _env) {
    this.ctx = ctx;
    // Hibernation-safe auto-response: a bare ping/pong never wakes the DO or runs JS.
    // WebSocketRequestResponsePair only exists in the real Workers runtime; tests exercise the
    // message-routing methods directly with a mock ctx that doesn't need it.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    }
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const url = new URL(request.url);
    /** @type {ChannelKind} */
    const kind = url.searchParams.get('kind') === 'runner' ? 'runner' : 'browser';
    const deviceId = url.searchParams.get('deviceId') || '';

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, deviceId ? [kind, `device:${deviceId}`] : [kind]);

    const state = await this.readState();
    if (kind === 'browser') {
      server.send(JSON.stringify({ type: 'hello', processes: state.processes, runnerConnected: this.ctx.getWebSockets('runner').length > 0 }));
    } else {
      server.send(JSON.stringify({ type: 'hello', processes: state.processes }));
      this.broadcast('browser', { type: 'runner_status', connected: true });
      // A runner that reconnects (sleep/network blip, not an explicit stop) must resume whatever
      // was running without the operator doing anything — the command itself never left D1/DO.
      for (const [name, process] of Object.entries(state.processes)) {
        if (process?.running) server.send(JSON.stringify({ type: 'command', process: name, action: 'start', params: process.params }));
      }
    }

    return new Response(null, { status: 101, webSocket: client });
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

    if (message.type === 'progress' || message.type === 'result') {
      this.broadcast('browser', message);
    }
  }

  /**
   * @param {WebSocket} ws
   * @param {number} _code
   * @param {string} _reason
   * @param {boolean} _wasClean
   */
  async webSocketClose(ws, _code, _reason, _wasClean) {
    if (this.tagsOf(ws).includes('runner') && this.ctx.getWebSockets('runner').length === 0) {
      this.broadcast('browser', { type: 'runner_status', connected: false });
    }
  }

  /**
   * @param {WebSocket} ws
   * @param {unknown} _error
   */
  async webSocketError(ws, _error) {
    await this.webSocketClose(ws, 1011, 'error', false);
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

  async readState() {
    const stored = await this.ctx.storage.get(STORAGE_KEY);
    return stored ?? { processes: {} };
  }

  /** @param {{processes: Record<string, ProcessState>}} state */
  async writeState(state) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }
}
