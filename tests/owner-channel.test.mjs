import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnerChannel } from '../workers/owner-channel.js';
import { createWhatsAppAutopostJob } from '../lib/messenger-automation.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

async function seedAutopostable(db, { chatId = 'wa-1' } = {}) {
  await seedChat(db, { id: chatId, platform: 'whatsapp', status: 'ready', joined: 10 });
  await db.prepare(`INSERT INTO library_items
    (id,user_id,kind,collection,version,title,uk_text,ru_text,tags_json,platforms_json,created_at,updated_at)
    VALUES ('ad-'||?1,'u','advertisement','advertisement',1,'Ad','Текст','Текст RU','[]','["whatsapp"]',1,1)`).bind(chatId).run();
  return chatId;
}

// OwnerChannel.fetch() constructs a real WebSocketPair/Response{webSocket}, which only exist inside
// the Workers runtime (Miniflare/production) — not in plain Node. These tests exercise the message
// routing/storage/business-logic methods directly with minimal mocks instead, matching how this repo
// already tests pure logic without spinning up a full runtime where a real one isn't needed. The
// upgrade handshake itself runs in workers/live-gateway.js before vinext (tests/live-gateway.test.mjs;
// the real 101 only exists in the Workers runtime — see docs/DEVELOPMENT_STATUS.md, 2026-10-04).

function mockSocket() {
  const sent = [];
  return { sent, readyState: 1, send: (data) => sent.push(JSON.parse(data)), close() { this.readyState = 3; } };
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
    // Matches what staging showed (2026-10-04): inside webSocketClose the closing socket is STILL
    // listed by getWebSockets(), only no longer OPEN — a "last runner gone" check must not count it.
    // getTags(ws) on that socket still resolves, so the close handler knows what the socket was.
    closeSocket(ws) { ws.readyState = 3; },
    getWebSockets(tag) { return sockets.filter((entry) => !tag || entry.tags.includes(tag)).map((entry) => entry.ws); },
    getTags(ws) { return sockets.find((entry) => entry.ws === ws)?.tags ?? []; },
    setWebSocketAutoResponse() {},
  };
}

function withSocket(ctx, ws, tags) {
  ctx.acceptWebSocket(ws, tags);
  return ws;
}

const emptyState = { userId: null, processes: {}, waitingCheckBatch: null, autopostCurrentJobId: null, discoveryCurrentTask: null, runnerLastSeenAt: null };

void test('a start command from the browser is relayed to runner sockets and persisted (the Discovery autonomous run still uses the generic command relay by design)', async () => {
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

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'discovery', action: 'start' }));
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'command', process: 'discovery', action: 'stop' }));

  const state = await ctx.storage.get('state');
  assert.equal(state.processes.discovery.running, false);
});

void test('runner progress messages for the Discovery autonomous run (generic relay, not the per-candidate protocol) reach browser sockets only', async () => {
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

// --- autopost: real business logic, backed by local D1 (Miniflare) ---

async function wake(channel, userId) {
  const url = new URL(`https://owner-channel/autopost-wake?userId=${encodeURIComponent(userId)}`);
  return channel.fetch(new Request(url, { method: 'POST' }));
}

void test('creating a job and waking the DO dispatches it to the runner', async (t) => {
  const db = await localDatabase(t);
  const chatId = await seedAutopostable(db);
  const job = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_wake_1_long', chatId }, 100, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  await wake(channel, 'u');

  assert.equal(runner.sent.length, 1);
  assert.equal(runner.sent[0].type, 'task');
  assert.equal(runner.sent[0].process, 'autopost');
  assert.equal(runner.sent[0].task.jobId, job.id);
  assert.equal((await db.prepare(`SELECT status FROM whatsapp_autopost_jobs WHERE id=?1`).bind(job.id).first()).status, 'claimed');
});

void test('a sent result completes the job and dispatches the next pending one', async (t) => {
  const db = await localDatabase(t);
  const a = await seedAutopostable(db, { chatId: 'wa-a' });
  const b = await seedAutopostable(db, { chatId: 'wa-b' });
  const jobA = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_a_long_enough', chatId: a }, 100, '2026-09-24');
  await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_b_long_enough', chatId: b }, 101, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await wake(channel, 'u');

  await channel.webSocketMessage(runner, JSON.stringify({
    type: 'result', process: 'autopost', jobId: jobA.id, status: 'sent',
    observedTarget: (await db.prepare(`SELECT expected_name FROM whatsapp_autopost_jobs WHERE id=?1`).bind(jobA.id).first()).expected_name,
    targetVerified: true, sendConfirmed: true,
  }));

  assert.equal((await db.prepare(`SELECT status FROM whatsapp_autopost_jobs WHERE id=?1`).bind(jobA.id).first()).status, 'sent');
  assert.equal(runner.sent.at(-1).type, 'task');
  assert.notEqual(runner.sent.at(-1).task.jobId, jobA.id);
});

void test('a disconnect releases the in-flight job back to pending instead of leaking a stuck claim', async (t) => {
  const db = await localDatabase(t);
  const chatId = await seedAutopostable(db);
  const job = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_disconnect_long', chatId }, 100, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await wake(channel, 'u');
  assert.equal((await db.prepare(`SELECT status FROM whatsapp_autopost_jobs WHERE id=?1`).bind(job.id).first()).status, 'claimed');

  ctx.closeSocket(runner);
  await channel.webSocketClose(runner, 1006, 'network', false);

  assert.equal((await db.prepare(`SELECT status FROM whatsapp_autopost_jobs WHERE id=?1`).bind(job.id).first()).status, 'pending');
});

void test('a runtime-problem release waits for an explicit ready before redispatching', async (t) => {
  const db = await localDatabase(t);
  const chatId = await seedAutopostable(db);
  const job = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_release_long', chatId }, 100, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await wake(channel, 'u');
  runner.sent.length = 0;

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'release', process: 'autopost', jobId: job.id }));
  assert.deepEqual(runner.sent, []);
  assert.equal((await db.prepare(`SELECT status FROM whatsapp_autopost_jobs WHERE id=?1`).bind(job.id).first()).status, 'pending');

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'ready', process: 'autopost' }));
  assert.equal(runner.sent[0]?.task?.jobId, job.id);
});

void test('stop tells the runner to cancel the check in progress; stopping an inactive batch sends nothing', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const started = await (await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) })).json();
  runner.sent.length = 0;

  await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
  assert.deepEqual(runner.sent, [{ type: 'cancel', process: 'waiting_check', batchId: started.batchId }]);

  runner.sent.length = 0;
  await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
  assert.deepEqual(runner.sent, []);
});

void test('a runner connecting alone releases tasks left in flight by a connection whose close was never processed', async (t) => {
  const db = await localDatabase(t);
  const chatId = await seedAutopostable(db);
  const job = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_orphan_long', chatId }, 100, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const first = withSocket(ctx, mockSocket(), ['runner']);
  await wake(channel, 'u');
  assert.equal(first.sent.at(-1).task.jobId, job.id);
  // The old connection vanishes without webSocketClose ever running (what staging did before the fix).
  first.readyState = 3;

  const second = withSocket(ctx, mockSocket(), ['runner']);
  await channel.onRunnerConnected(second, 'u');

  const task = second.sent.find((message) => message.type === 'task' && message.process === 'autopost');
  assert.equal(task?.task.jobId, job.id, 'the orphaned claim is released and dispatched again to the new runner');
});

// Commit 3f: browsers subscribe to the live channel instead of polling, so every autopost state change
// that alters what the queue shows must reach them; the queue reload itself stays the source of truth.
void test('autopost queue changes, dispatch, completion and release are all broadcast to browser sockets', async (t) => {
  const db = await localDatabase(t);
  const a = await seedAutopostable(db, { chatId: 'wa-a' });
  const b = await seedAutopostable(db, { chatId: 'wa-b' });
  const jobA = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_live_a_long', chatId: a }, 100, '2026-09-24');
  const jobB = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_live_b_long', chatId: b }, 101, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);

  await wake(channel, 'u');
  assert.deepEqual(browser.sent, [
    { type: 'process_state', process: 'autopost', jobId: null, status: 'queue_changed' },
    { type: 'process_state', process: 'autopost', jobId: jobA.id, status: 'running' },
  ]);
  assert.ok(runner.sent.every((message) => message.type !== 'process_state'), 'browser-facing broadcasts never go to the runner');

  browser.sent.length = 0;
  await channel.webSocketMessage(runner, JSON.stringify({
    type: 'result', process: 'autopost', jobId: jobA.id, status: 'sent',
    observedTarget: (await db.prepare(`SELECT expected_name FROM whatsapp_autopost_jobs WHERE id=?1`).bind(jobA.id).first()).expected_name,
    targetVerified: true, sendConfirmed: true,
  }));
  assert.deepEqual(browser.sent, [
    { type: 'process_state', process: 'autopost', jobId: jobA.id, status: 'sent' },
    { type: 'process_state', process: 'autopost', jobId: jobB.id, status: 'running' },
  ]);

  browser.sent.length = 0;
  await channel.webSocketMessage(runner, JSON.stringify({ type: 'release', process: 'autopost', jobId: jobB.id }));
  assert.deepEqual(browser.sent, [{ type: 'process_state', process: 'autopost', jobId: jobB.id, status: 'released' }]);
});

void test('a runner disconnect with an in-flight autopost job tells browsers the job was released and the runner went offline', async (t) => {
  const db = await localDatabase(t);
  const chatId = await seedAutopostable(db);
  const job = await createWhatsAppAutopostJob(db, 'u', { requestKey: 'request_live_drop_long', chatId }, 100, '2026-09-24');
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);
  await wake(channel, 'u');
  browser.sent.length = 0;

  ctx.closeSocket(runner);
  await channel.webSocketClose(runner, 1006, 'network', false);

  assert.deepEqual(browser.sent, [
    { type: 'process_state', process: 'autopost', jobId: job.id, status: 'released' },
    { type: 'runner_status', connected: false },
  ]);
});

void test('waiting_check start and stop over HTTP are broadcast to every browser socket with the same payload the caller gets', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'a', platform: 'whatsapp', status: 'waiting' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const otherDevice = withSocket(ctx, mockSocket(), ['browser']);

  const started = await (await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'start' }) })).json();
  assert.deepEqual(otherDevice.sent, [{ type: 'process_state', process: 'waiting_check', ...started }]);

  otherDevice.sent.length = 0;
  const stopped = await (await waitingCheckRequest(channel, 'u', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })).json();
  assert.equal(stopped.active, false);
  assert.deepEqual(otherDevice.sent, [{ type: 'process_state', process: 'waiting_check', ...stopped }]);
});

// --- discovery (per-candidate executor): real business logic, backed by local D1 (Miniflare) ---
// Commit 3d. Unlike autopost, there is no D1 lease to claim/release: the candidate rows carry no
// ownership columns anymore, so the open WebSocket plus the in-memory discoveryCurrentTask are the
// only proof of "who is working on this". The Discovery autonomous run (source crawl goal/cursor)
// is untouched by this commit and still speaks the generic command/progress relay tested above.

async function seedDiscoveryCandidate(db, { id, chatId, platform = 'whatsapp' } = {}) {
  await seedChat(db, { id: chatId, platform, status: 'to_join' });
  const link = `https://example.test/${chatId}`;
  await db.prepare(`INSERT INTO chat_discovery_candidates
    (id,user_id,platform,link,normalized_link,discovered_at,imported_chat_id,created_at,updated_at)
    VALUES (?1,'u',?2,?3,?3,1,?4,1,1)`).bind(id, platform, link, chatId).run();
  return { candidateId: id, chatId };
}

// Already rejected and joined externally: deriveAction returns 'leave' regardless of pacing, so the
// dispatched task's resultAction is 'executor-leave' instead of 'inspect'.
async function seedDiscoveryLeaveCandidate(db, { id, chatId }) {
  await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,joined_at,archived_at,created_at,updated_at)
    VALUES (?1,'u','whatsapp',?1,?2,?2,'archived',1,1,1,1)`).bind(chatId, `https://example.test/${chatId}`).run();
  const link = `https://example.test/${id}`;
  await db.prepare(`INSERT INTO chat_discovery_candidates
    (id,user_id,platform,link,normalized_link,discovered_at,membership_state,decision,imported_chat_id,created_at,updated_at)
    VALUES (?1,'u','whatsapp',?2,?2,1,'joined','rejected',?3,1,1)`).bind(id, link, chatId).run();
  return { candidateId: id, chatId };
}

async function discoveryWake(channel, userId) {
  const url = new URL(`https://owner-channel/discovery-wake?userId=${encodeURIComponent(userId)}`);
  return channel.fetch(new Request(url, { method: 'POST' }));
}

void test('waking the DO dispatches the next Discovery candidate to the runner as a join_and_inspect task', async (t) => {
  const db = await localDatabase(t);
  const { candidateId, chatId } = await seedDiscoveryCandidate(db, { id: 'cand-1', chatId: 'wa-1' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);

  await discoveryWake(channel, 'u');

  assert.equal(runner.sent.length, 1);
  assert.equal(runner.sent[0].type, 'task');
  assert.equal(runner.sent[0].process, 'discovery');
  assert.equal(runner.sent[0].task.candidateId, candidateId);
  assert.equal(runner.sent[0].task.chatId, chatId);
  assert.equal(runner.sent[0].task.action, 'join_and_inspect');
  assert.equal(runner.sent[0].task.resultAction, 'inspect');
});

void test('an inspect result applies the inspection and dispatches the next candidate', async (t) => {
  const db = await localDatabase(t);
  await seedDiscoveryCandidate(db, { id: 'cand-a', chatId: 'wa-a' });
  await seedDiscoveryCandidate(db, { id: 'cand-b', chatId: 'wa-b' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await discoveryWake(channel, 'u');
  const task = runner.sent[0].task;
  assert.equal(task.candidateId, 'cand-a');

  await channel.webSocketMessage(runner, JSON.stringify({
    type: 'result', process: 'discovery', candidateId: task.candidateId,
    result: {
      status: 'inspected', targetVerified: true, accessible: true, membershipState: 'joined',
      observedName: 'Українці Тест', chatType: 'group', memberCount: 900,
      topicMatch: 'match', canWrite: true, adsPolicy: 'allowed', activityState: 'active',
    },
  }));

  const stored = await db.prepare(`SELECT decision FROM chat_discovery_candidates WHERE id=?1`).bind('cand-a').first();
  assert.equal(stored.decision, 'target');
  assert.equal(runner.sent.at(-1).type, 'task');
  assert.equal(runner.sent.at(-1).task.candidateId, 'cand-b');
});

void test('a Discovery executor-leave result confirms the external leave using the dispatched task\'s chatStateToken', async (t) => {
  const db = await localDatabase(t);
  const { candidateId, chatId } = await seedDiscoveryLeaveCandidate(db, { id: 'cand-leave', chatId: 'wa-leave' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await discoveryWake(channel, 'u');
  const task = runner.sent[0].task;
  assert.equal(task.candidateId, candidateId);
  assert.equal(task.resultAction, 'executor-leave');

  await channel.webSocketMessage(runner, JSON.stringify({
    type: 'result', process: 'discovery', candidateId: task.candidateId,
    chatStateToken: task.chatStateToken, targetVerified: true,
  }));

  assert.ok((await readChatState(db, 'u', chatId)).left_at !== null);
});

void test('a stale Discovery result for a candidate that is no longer the in-flight task is ignored', async (t) => {
  const db = await localDatabase(t);
  const { candidateId } = await seedDiscoveryCandidate(db, { id: 'cand-stale', chatId: 'wa-stale' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await discoveryWake(channel, 'u');

  await channel.webSocketMessage(runner, JSON.stringify({
    type: 'result', process: 'discovery', candidateId: 'not-the-current-one',
    result: { status: 'inspected', targetVerified: true, accessible: true, membershipState: 'joined' },
  }));

  const stored = await db.prepare(`SELECT decision FROM chat_discovery_candidates WHERE id=?1`).bind(candidateId).first();
  assert.equal(stored.decision, 'review');
});

void test('a Discovery runtime-problem release waits for an explicit ready before redispatching', async (t) => {
  const db = await localDatabase(t);
  const { candidateId } = await seedDiscoveryCandidate(db, { id: 'cand-rel', chatId: 'wa-rel' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await discoveryWake(channel, 'u');
  runner.sent.length = 0;

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'release', process: 'discovery', candidateId }));
  assert.deepEqual(runner.sent, []);

  await channel.webSocketMessage(runner, JSON.stringify({ type: 'ready', process: 'discovery' }));
  assert.equal(runner.sent[0]?.task?.candidateId, candidateId);
});

void test('a Discovery disconnect forgets the in-flight task (nothing to release in D1) so reconnect redispatches the same candidate', async (t) => {
  const db = await localDatabase(t);
  const { candidateId } = await seedDiscoveryCandidate(db, { id: 'cand-disc', chatId: 'wa-disc' });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner']);
  await discoveryWake(channel, 'u');
  assert.equal(runner.sent[0].task.candidateId, candidateId);

  ctx.closeSocket(runner);
  await channel.webSocketClose(runner, 1006, 'network', false);

  const reconnected = withSocket(ctx, mockSocket(), ['runner']);
  await channel.onRunnerConnected(reconnected, 'u');
  assert.ok(reconnected.sent.some((message) => message.type === 'task' && message.task?.candidateId === candidateId));
});
