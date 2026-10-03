// Durable Object: one instance per owner (idFromName(userId)), reached only through
// app/api/live/route.ts (which has already authenticated the connection — this class trusts
// its caller and does no auth of its own). Holds live process state in ctx.storage and relays
// commands/progress between the browser and the local runner over Hibernatable WebSockets, so
// neither side has to poll D1 to find out what the other is doing.
//
// D1 keeps only durable facts (chats, publications, qualification outcomes); "who is running,
// who owns the current task" lives here instead of the old time-limited lease/fencing columns —
// an open WebSocket connection *is* the ownership proof, so there is nothing to expire.

export type ChannelKind = 'browser' | 'runner';
export type ProcessName = 'waiting_check' | 'autopost' | 'discovery';

type ProcessState = {
  running: boolean;
  params: unknown;
  updatedAt: number;
};

type StoredState = {
  processes: Partial<Record<ProcessName, ProcessState>>;
};

type ChannelMessage =
  | { type: 'command'; process: ProcessName; action: 'start' | 'stop'; params?: unknown }
  | { type: 'progress' | 'result'; process: ProcessName; data: unknown }
  | { type: 'ping' };

const STORAGE_KEY = 'state';
const PING = JSON.stringify({ type: 'ping' });
const PONG = JSON.stringify({ type: 'pong' });

export class OwnerChannel implements DurableObject {
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Cloudflare.Env) {
    this.ctx = ctx;
    // Hibernation-safe auto-response: a bare ping/pong never wakes the DO or runs JS.
    // WebSocketRequestResponsePair only exists in the real Workers runtime; tests exercise the
    // message-routing methods directly with a mock ctx that doesn't need it.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const url = new URL(request.url);
    const kind: ChannelKind = url.searchParams.get('kind') === 'runner' ? 'runner' : 'browser';
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

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let message: ChannelMessage;
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

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    if (this.tagsOf(ws).includes('runner') && this.ctx.getWebSockets('runner').length === 0) {
      this.broadcast('browser', { type: 'runner_status', connected: false });
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error', false);
  }

  private tagsOf(ws: WebSocket): string[] {
    return this.ctx.getTags(ws);
  }

  private broadcast(kind: ChannelKind, message: unknown) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets(kind)) {
      try { socket.send(payload); } catch { /* socket closing concurrently; next close event cleans up */ }
    }
  }

  private async readState(): Promise<StoredState> {
    const stored = await this.ctx.storage.get<StoredState>(STORAGE_KEY);
    return stored ?? { processes: {} };
  }

  private async writeState(state: StoredState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }
}
