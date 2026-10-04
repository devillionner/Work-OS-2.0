import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnerChannel } from '../workers/owner-channel.js';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

// OwnerChannel.fetch() constructs a real WebSocketPair/Response{webSocket}, which only exist inside
// the Workers runtime (Miniflare/production) — not in plain Node. These tests exercise the message
// routing/storage/business-logic methods directly with minimal mocks instead, matching how this repo
// already tests pure logic without spinning up a full runtime where a real one isn't needed. The
// upgrade handshake itself is verified live against staging (see docs/DEVELOPMENT_STATUS.md).

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

const emptyState = { userId: null, processes: {}, waitingCheckBatch: null, runnerLastSeenAt: null };

void test('a start command from the browser is relayed to runner sockets and persisted (generic processes not yet migrated)', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  await channel.webSocketMessage(browser, JSON.stringify({ type: 'command', process: 'discovery', action: 'start', params: { goal: 5 } }));

  assert.deepEqual(runner.sent, [{ type: 'command', process: 'discovery', action: 'start', params: { goal: 5 } }]);
  assert.deepEqual(browser.sent, [{ type: 'process_state', process: 'discovery', running: true, params: { goal: 5 }, updatedAt: browser.sent[0].updatedAt }]);
  assert.deepEqual(await ctx.storage.get('state'), {
    ...emptyState,
    processes: { discovery: { running: true, params: { goal: 5 }, updatedAt: browser.sent[0].updatedAt } },
  });
});

void test('stop clears the running flag so a reconnecting runner is not told to resume', async () => {
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, {});
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'autopost', action: 'start' }));
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'autopost', action: 'stop' }));

  const state = await ctx.storage.get('state');
  assert.equal(state.processes.autopost.running, false);
});

void test('runner progress/result messages for a not-yet-migrated process reach browser sockets only', async () => {
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

// --- waiting_check: real business logic, backed by local D1 (Miniflare) ---

async function waitingCheckRequest(channel, userId, init) {
  const url = new URL(`https://owner-channel/waiting-check?userId=${encodeURIComponent(userId)}`);
  return channel.fetch(new Request(url, init));
}

void test('starting waiting_check over HTTP dispatches the first task to the runner', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  await seedChat(db, { id: 'b', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const response = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const status = await response.json();

  assert.equal(status.active, true);
  assert.equal(status.total, 2);
  assert.deepEqual(runner.sent, [{ type: 'task', process: 'waiting_check', task: { kind: 'whatsapp_waiting_check', batchId: status.batchId, chatId: 'a', name: 'a', link: 'https://example.test/a' } }]);
});

void test('starting with no runner connected still records the task; a later reconnect resumes it', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });

  await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });

  // onRunnerConnected is the connection-bookkeeping half of acceptChannel, split out specifically so
  // it can be driven with a mock socket instead of a real WebSocketPair (unavailable in plain Node).
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await channel.onRunnerConnected(runner, 'u');
  assert.ok(runner.sent.some((message) => message.type === 'task' && message.task.chatId === 'a'));
});

void test('a joined result moves the chat to ready and advances to the next task', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  await seedChat(db, { id: 'b', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  const startResponse = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId } = await startResponse.json();

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: 'a', status: 'joined' }));

  assert.equal((await db.prepare(`SELECT workflow_status FROM chats WHERE id='a'`).first()).workflow_status, 'ready');
  assert.deepEqual(runner.sent.at(-1), { type: 'task', process: 'waiting_check', task: { kind: 'whatsapp_waiting_check', batchId, chatId: 'b', name: 'b', link: 'https://example.test/b' } });
  assert.ok(browser.sent.some((message) => message.type === 'process_state' && message.process === 'waiting_check' && message.counts.joined === 1));
});

void test('three failures in a row stop the batch and a late result for the fenced chat is ignored', async (t) => {
  const db = await localDatabase(t);
  for (const id of ['f1', 'f2', 'f3', 'rest']) await seedChat(db, { id, platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const startResponse = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId } = await startResponse.json();

  for (const id of ['f1', 'f2', 'f3']) {
    await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: id, status: 'failed', reason: 'membership_not_confirmed' }));
  }
  const stoppedStatus = await (await waitingCheckRequest(channel, 'u', { method: 'GET' })).json();
  assert.equal(stoppedStatus.active, false);
  assert.match(stoppedStatus.stopReason, /3 помилки поспіль/);
  assert.equal((await db.prepare(`SELECT workflow_status FROM chats WHERE id='rest'`).first()).workflow_status, 'waiting');

  runner.sent.length = 0;
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: 'rest', status: 'joined' }));
  assert.equal((await db.prepare(`SELECT workflow_status FROM chats WHERE id='rest'`).first()).workflow_status, 'waiting');
  assert.deepEqual(runner.sent, []);
});

void test('stopping fences an in-flight task: a result reported right after stop does not mutate the chat', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const startResponse = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId } = await startResponse.json();
  await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'stop' }) });

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: 'a', status: 'joined' }));
  assert.equal((await db.prepare(`SELECT workflow_status FROM chats WHERE id='a'`).first()).workflow_status, 'waiting');
});

void test('a runtime-problem release puts the chat back without counting a failure and waits for an explicit ready', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  await seedChat(db, { id: 'b', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const startResponse = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId } = await startResponse.json();

  runner.sent.length = 0;
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'release', process: 'waiting_check', batchId, chatId: 'a' }));
  // Releasing must not immediately redispatch — a persistent global problem would otherwise become a tight loop.
  assert.deepEqual(runner.sent, []);

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'ready', process: 'waiting_check' }));
  assert.deepEqual(runner.sent, [{ type: 'task', process: 'waiting_check', task: { kind: 'whatsapp_waiting_check', batchId, chatId: 'a', name: 'a', link: 'https://example.test/a' } }]);

  const status = await (await waitingCheckRequest(channel, 'u', { method: 'GET' })).json();
  assert.equal(status.counts.failed, 0);
});

void test('retry_problems starts a new batch limited to the previous batch\'s problem chats', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'broken', platform: 'whatsapp', status: 'waiting' });
  await seedChat(db, { id: 'fine', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const start1 = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId: batch1 } = await start1.json();
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId: batch1, chatId: 'broken', status: 'failed', reason: 'invalid_whatsapp_link' }));
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId: batch1, chatId: 'fine', status: 'joined' }));

  const retry = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'retry_problems' }) });
  const retryStatus = await retry.json();
  assert.equal(retryStatus.total, 1);
  assert.deepEqual(runner.sent.at(-1), { type: 'task', process: 'waiting_check', task: { kind: 'whatsapp_waiting_check', batchId: retryStatus.batchId, chatId: 'broken', name: 'broken', link: 'https://example.test/broken' } });
});

void test('a finished batch reports enriched problems; an operator action removes a decided one', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'p1', platform: 'whatsapp', status: 'waiting' });
  await seedChat(db, { id: 'p2', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  const start = await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  const { batchId } = await start.json();
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: 'p1', status: 'failed', reason: 'whatsapp_join_retry_later' }));
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'result', process: 'waiting_check', batchId, chatId: 'p2', status: 'failed', reason: 'whatsapp_removed_from_group' }));

  const status = await (await waitingCheckRequest(channel, 'u', { method: 'GET' })).json();
  assert.deepEqual(status.problems.map((item) => [item.chatId, Boolean(item.chat?.stateToken)]), [['p1', true], ['p2', true]]);

  await db.prepare(`UPDATE chats SET workflow_status='archived',archived_at=1 WHERE id='p2'`).run();
  const after = await (await waitingCheckRequest(channel, 'u', { method: 'GET' })).json();
  assert.deepEqual(after.problems.map((item) => item.chatId), ['p1']);
  assert.equal(after.counts.failed, 2);
});
