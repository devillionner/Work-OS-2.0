import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnerChannel } from '../workers/owner-channel.ts';

// OwnerChannel.fetch() constructs a real WebSocketPair/Response{webSocket}, which only exist inside
// the Workers runtime (Miniflare/production) — not in plain Node. These tests exercise the message
// routing/storage methods directly with minimal mocks instead, matching how this repo already tests
// pure logic without spinning up a full runtime where a real one isn't needed. The upgrade handshake
// itself is verified live against staging (see docs/DEVELOPMENT_STATUS.md) once this ships.

function mockSocket() {
  const sent = [];
  return { sent, send: (data) => sent.push(JSON.parse(data)) };
}

function mockCtx() {
  const stored = new Map();
  const sockets = [];
  return {
    sockets,
    storage: {
      get: async (key) => stored.get(key),
      put: async (key, value) => { stored.set(key, value); },
    },
    acceptWebSocket(ws, tags = []) { sockets.push({ ws, tags, closed: false }); },
    // Matches the real Hibernation API: a just-closed socket drops out of getWebSockets() (so a
    // "last runner gone" check sees zero), but getTags(ws) on that same socket still resolves —
    // the close handler needs to know what the closing socket WAS.
    closeSocket(ws) { const entry = sockets.find((item) => item.ws === ws); if (entry) entry.closed = true; },
    getWebSockets(tag) { return sockets.filter((entry) => !entry.closed && (!tag || entry.tags.includes(tag))).map((entry) => entry.ws); },
    getTags(ws) { return sockets.find((entry) => entry.ws === ws)?.tags ?? []; },
    setWebSocketAutoResponse() {},
  };
}

function withSocket(ctx, ws, tags) {
  ctx.acceptWebSocket(ws, tags);
  return ws;
}

void test('a start command from the browser is relayed to runner sockets and persisted', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  await channel.webSocketMessage(browser, JSON.stringify({ type: 'command', process: 'waiting_check', action: 'start', params: { goal: 5 } }));

  assert.deepEqual(runner.sent, [{ type: 'command', process: 'waiting_check', action: 'start', params: { goal: 5 } }]);
  assert.deepEqual(browser.sent, [{ type: 'process_state', process: 'waiting_check', running: true, params: { goal: 5 }, updatedAt: browser.sent[0].updatedAt }]);
  assert.deepEqual(await ctx.storage.get('state'), { processes: { waiting_check: { running: true, params: { goal: 5 }, updatedAt: browser.sent[0].updatedAt } } });
});

void test('stop clears the running flag so a reconnecting runner is not told to resume', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'discovery', action: 'start' }));
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'discovery', action: 'stop' }));

  const state = await ctx.storage.get('state');
  assert.equal(state.processes.discovery.running, false);
});

void test('runner progress/result messages reach browser sockets only, never other runner sockets', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runnerA = withSocket(ctx, mockSocket(), ['runner']);
  const runnerB = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  await channel.webSocketMessage(runnerA, JSON.stringify({ type: 'progress', process: 'discovery', data: { checked: 3 } }));

  assert.deepEqual(browser.sent, [{ type: 'progress', process: 'discovery', data: { checked: 3 } }]);
  assert.deepEqual(runnerB.sent, []);
});

void test('a disconnecting runner tells browsers it went offline, but a disconnecting browser says nothing', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  ctx.closeSocket(runner);
  await channel.webSocketClose(runner, 1006, 'network', false);
  assert.deepEqual(browser.sent, [{ type: 'runner_status', connected: false }]);

  browser.sent.length = 0;
  await channel.webSocketClose(browser, 1000, 'bye', true);
  assert.deepEqual(browser.sent, []);
});

void test('an unparseable or unknown message is ignored instead of throwing', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const browser = withSocket(ctx, mockSocket(), ['browser']);
  await assert.doesNotReject(channel.webSocketMessage(browser, 'not json'));
  await assert.doesNotReject(channel.webSocketMessage(browser, JSON.stringify({ type: 'unknown' })));
});

void test('ping is answered directly without touching storage or other sockets', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'ping' }));
  assert.deepEqual(runner.sent, [{ type: 'pong' }]);
  assert.equal(await ctx.storage.get('state'), undefined);
});
