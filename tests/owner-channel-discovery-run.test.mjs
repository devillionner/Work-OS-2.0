import assert from 'node:assert/strict';
import test from 'node:test';

import { OwnerChannel } from '../workers/owner-channel.js';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

// The Discovery autonomous run in the owner Durable Object (2026-10-04): the DO owns the run state that
// used to live in the Work OS tab, pushes one run item at a time to the runner and parses crawled Telegram
// sources itself (D1 read-only). Mock sockets as in tests/owner-channel.test.mjs.

function mockSocket() {
  const sent = [];
  return { sent, readyState: 1, send: (data) => sent.push(JSON.parse(data)), close() { this.readyState = 3; },
    attachment: null, serializeAttachment(value) { this.attachment = value; }, deserializeAttachment() { return this.attachment; } };
}

function mockCtx() {
  const stored = new Map();
  const sockets = [];
  const alarms = [];
  return {
    sockets, alarms, stored,
    storage: {
      async get(key) { return stored.get(key); },
      async put(key, value) {
        if (typeof key === 'string') { stored.set(key, structuredClone(value)); return; }
        for (const [entryKey, entryValue] of Object.entries(key)) stored.set(entryKey, structuredClone(entryValue));
      },
      async delete(keys) { let count = 0; for (const key of [].concat(keys)) count += stored.delete(key) ? 1 : 0; return count; },
      async list({ prefix }) { return new Map([...stored].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, structuredClone(value)])); },
      async setAlarm(at) { alarms.push(at); },
    },
    acceptWebSocket(ws, tags = []) { sockets.push({ ws, tags }); },
    getWebSockets(tag) { return sockets.filter((entry) => !tag || entry.tags.includes(tag)).map((entry) => entry.ws); },
    getTags(ws) { return sockets.find((entry) => entry.ws === ws)?.tags ?? []; },
    getWebSocketAutoResponseTimestamp() { return null; },
    setWebSocketAutoResponse() {},
  };
}

function withSocket(ctx, ws, tags) { ctx.acceptWebSocket(ws, tags); return ws; }

async function runRequest(channel, init) {
  const url = new URL('https://owner-channel/discovery-run');
  url.searchParams.set('userId', 'u');
  return channel.fetch(new Request(url, { headers: { 'Content-Type': 'application/json' }, ...init }));
}
const post = async (channel, body) => (await runRequest(channel, { method: 'POST', body: JSON.stringify(body) })).json();
const message = (channel, socket, body) => channel.webSocketMessage(socket, JSON.stringify({ process: 'discovery_run', ...body }));
const ofType = (socket, type) => socket.sent.filter((item) => item.type === type);

const INVITE = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
const telegramSource = {
  sourceUrl: 'https://t.me/ua_berlin_chat', sourceTitle: 'Українці Берлін', query: 'Українці Берлін', seedLabel: 'Берлін',
  context: '', text: `Наш чат WhatsApp для українців у Берліні: ${INVITE}`,
};

async function setup(t) {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'tg-1', platform: 'telegram', status: 'ready', joined: 10 });
  const ctx = mockCtx();
  const channel = new OwnerChannel(ctx, { DB: db });
  const runner = withSocket(ctx, mockSocket(), ['runner', 'conn:r']);
  const browser = withSocket(ctx, mockSocket(), ['browser']);
  return { db, ctx, channel, runner, browser };
}

void test('starting a run sends the plan to the runner and, with an empty queue, the first Telegram step', async (t) => {
  const { channel, runner, browser } = await setup(t);
  const started = await post(channel, { action: 'start', goal: 1 });

  assert.equal(started.run.running, true);
  assert.equal(started.run.goal, 1);
  const plan = ofType(runner, 'run_plan')[0];
  assert.equal(plan.runId, started.run.runId);
  assert.ok(Array.isArray(plan.seedData.keywords) && plan.seedData.keywords.length > 0, 'the curated seed plan travels with the run');
  assert.deepEqual(plan.telegramGroups.map((group) => group.link), ['https://example.test/tg-1'], 'joined Telegram groups are read from D1 once per start');
  assert.deepEqual(ofType(runner, 'run_control').at(-1), { type: 'run_control', process: 'discovery_run', runId: started.run.runId, active: true });
  assert.deepEqual(ofType(runner, 'run_source').map((item) => item.cursor), [0]);
  assert.ok(ofType(browser, 'process_state').some((item) => item.process === 'discovery_run' && item.running === true));

  assert.equal((await runRequest(channel, { method: 'POST', body: JSON.stringify({ action: 'start' }) })).status, 409, 'one run at a time');
});

void test('a crawled Telegram step becomes a queued candidate, which is dispatched for a WhatsApp check; a target result reaches the goal', async (t) => {
  const { channel, runner, browser } = await setup(t);
  const { run } = await post(channel, { action: 'start', goal: 1 });
  runner.sent.length = 0;

  await message(channel, runner, { type: 'source_result', runId: run.runId, batch: { nextCursor: 1, searched: 1, done: false, totalTasks: 30 }, sources: [telegramSource], scannedGroups: ['ua_berlin_chat'] });
  const applied = ofType(runner, 'run_source_applied')[0];
  assert.equal(applied.added, 1);
  assert.deepEqual(applied.scannedGroups, ['ua_berlin_chat']);
  const task = ofType(runner, 'run_task')[0]?.task;
  assert.equal(task?.link, INVITE, 'a queued candidate is checked before another Telegram step');

  await message(channel, runner, { type: 'progress', candidateId: task.candidateId, runId: run.runId, checkpoint: { attempts: 1 } });
  let state = (await (await runRequest(channel, { method: 'GET' })).json()).run;
  assert.equal(state.activeCandidateId, task.candidateId);
  assert.equal(state.telegramCursor, 1);

  browser.sent.length = 0;
  await message(channel, runner, { type: 'result', candidateId: task.candidateId, payload: {
    decision: 'target', reasonCodes: [], completedAt: Date.now(), runId: run.runId,
    result: { status: 'inspected', observedName: 'Українці Берлін WA', memberCount: 1200, chatType: 'group', topicMatch: 'match', canWrite: true, membershipState: 'joined', accessible: true, targetVerified: true, groupId: 'g1' },
  } });
  state = (await (await runRequest(channel, { method: 'GET' })).json()).run;
  assert.equal(state.candidates[0].preflightState, 'target');
  assert.equal(state.done, true);
  assert.equal(state.completionReason, 'goal_reached');
  assert.equal(state.activeCandidateId, null);
  assert.ok(ofType(browser, 'process_state').some((item) => item.process === 'discovery_run' && item.done === true));
});

void test('pause tells the runner to stop and abandons the in-flight item; resume redispatches it', async (t) => {
  const { channel, runner } = await setup(t);
  const { run } = await post(channel, { action: 'start', goal: 5 });
  await message(channel, runner, { type: 'source_result', runId: run.runId, batch: { nextCursor: 1, searched: 1, done: false, totalTasks: 30 }, sources: [telegramSource] });
  const task = ofType(runner, 'run_task')[0].task;
  runner.sent.length = 0;

  const paused = await post(channel, { action: 'pause' });
  assert.equal(paused.run.running, false);
  assert.equal(paused.run.pauseSummary.unverified, 1);
  assert.deepEqual(ofType(runner, 'run_control').at(-1), { type: 'run_control', process: 'discovery_run', runId: run.runId, active: false });

  runner.sent.length = 0;
  const resumed = await post(channel, { action: 'resume' });
  assert.equal(resumed.run.running, true);
  assert.equal(ofType(runner, 'run_task')[0]?.task.candidateId, task.candidateId, 'the same candidate is dispatched again after resume');
});

void test('a WhatsApp-runtime release hands the turn to Telegram steps and arms a wake-up; a Telegram block pauses on the same step', async (t) => {
  const { ctx, channel, runner } = await setup(t);
  const { run } = await post(channel, { action: 'start', goal: 5 });
  await message(channel, runner, { type: 'source_result', runId: run.runId, batch: { nextCursor: 1, searched: 1, done: false, totalTasks: 30 }, sources: [telegramSource] });
  const task = ofType(runner, 'run_task')[0].task;
  runner.sent.length = 0;

  const blockedUntil = Date.now() + 60_000;
  await message(channel, runner, { type: 'release', candidateId: task.candidateId, until: Date.now() + 15_000, runtimeBlockedUntil: blockedUntil });
  assert.deepEqual(ofType(runner, 'run_task'), []);
  assert.deepEqual(ofType(runner, 'run_source').map((item) => item.cursor), [1], 'the queue is short, so Telegram gets the turn');

  await message(channel, runner, { type: 'pause', runId: run.runId, reason: 'telegram_flood_wait', query: 'Українці Берлін' });
  const state = (await (await runRequest(channel, { method: 'GET' })).json()).run;
  assert.equal(state.running, false);
  assert.equal(state.completionReason, 'source_error');
  assert.equal(state.telegramCursor, 1, 'resume continues from the blocked step');
  assert.deepEqual(state.sourceIssues, [{ reason: 'telegram_flood_wait', query: 'Українці Берлін' }]);
  assert.ok(ctx.alarms.length >= 0);
});

void test('confirm/archive/non-target/retry from the UI update the run; a reconnecting runner gets the plan and the next item', async (t) => {
  const { ctx, channel, runner } = await setup(t);
  const { run } = await post(channel, { action: 'start', goal: 5 });
  await message(channel, runner, { type: 'source_result', runId: run.runId, batch: { nextCursor: 1, searched: 1, done: false, totalTasks: 30 }, sources: [telegramSource] });
  const task = ofType(runner, 'run_task')[0].task;
  await message(channel, runner, { type: 'result', candidateId: task.candidateId, payload: { decision: 'unavailable', reasonCodes: ['retry_exhausted'], completedAt: Date.now(), runId: run.runId, result: { membershipState: 'joined', groupId: 'g7' } } });

  await post(channel, { action: 'pause' });
  const retried = await post(channel, { action: 'retry', candidateId: task.candidateId });
  assert.equal(retried.run.candidates[0].preflightState, 'queued');
  assert.equal(retried.run.candidates[0].discoveryCheckpoint.result.groupId, 'g7');
  const rejected = await post(channel, { action: 'non-target', candidateId: task.candidateId });
  assert.equal(rejected.run.candidates[0].preflightState, 'rejected');
  const archived = await post(channel, { action: 'archived', candidateIds: [task.candidateId] });
  assert.deepEqual(archived.run.candidates, []);

  // Runner drops and reconnects mid-run: the plan and the next item are pushed again.
  await post(channel, { action: 'resume' });
  ctx.sockets.splice(0, ctx.sockets.length);
  const again = withSocket(ctx, mockSocket(), ['runner', 'conn:r2']);
  await channel.onRunnerConnected(again, 'u');
  assert.equal(ofType(again, 'run_plan')[0]?.runId, run.runId);
  assert.ok(ofType(again, 'run_source').length + ofType(again, 'run_task').length === 1, 'exactly one run item is pushed');
});

// Awaiting D1 lets other events into a Durable Object. A pause pressed on a phone while a Telegram step's
// duplicate check runs must survive the step (it used to be a sessionStorage race in the tab, too).
void test('a pause that arrives during a Telegram step\'s D1 work is not undone by the step', async (t) => {
  const { db, ctx, runner } = await setup(t);
  let hook = null;
  const wrap = (statement) => {
    const wrapped = Object.create(statement);
    wrapped.bind = (...values) => wrap(statement.bind(...values));
    for (const method of ['all', 'first', 'run']) wrapped[method] = async (...args) => { if (hook) { const run = hook; hook = null; await run(); } return statement[method](...args); };
    return wrapped;
  };
  const slowDb = new Proxy(db, { get(target, property) {
    if (property === 'prepare') return (sql) => wrap(target.prepare(sql));
    if (property === 'batch') return async (statements) => { if (hook) { const run = hook; hook = null; await run(); } return target.batch(statements); };
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const channel = new OwnerChannel(ctx, { DB: slowDb });
  const { run } = await post(channel, { action: 'start', goal: 5 });

  hook = async () => { await post(channel, { action: 'pause' }); };
  await message(channel, runner, { type: 'source_result', runId: run.runId, batch: { nextCursor: 1, searched: 1, done: false, totalTasks: 30 }, sources: [telegramSource] });

  const state = (await (await runRequest(channel, { method: 'GET' })).json()).run;
  assert.equal(state.running, false, 'the pause pressed during the step stays in effect');
  assert.ok(state.pauseSummary);
  assert.equal(hook, null, 'the pause really ran in the middle of the D1 work');
});
