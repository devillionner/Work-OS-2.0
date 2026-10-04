import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Commit 3f: the browser's live-channel client (lib/live-channel.ts) is a page-wide singleton, so this
// file drives one sequential scenario against a fake WebSocket and mocked timers instead of a real
// runtime — the reconnect/keepalive rules are what matter here, the DO side has its own tests.

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = FakeWebSocket.OPEN; this.dispatchEvent(new Event('open')); }
  receive(message) {
    const event = new Event('message');
    event.data = JSON.stringify(message);
    this.dispatchEvent(event);
  }
  fail() { this.dispatchEvent(new Event('error')); }
  drop() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.window = { location: { protocol: 'https:', host: 'work-os.example.test' }, addEventListener() {} };
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const sockets = FakeWebSocket.instances;
const latest = () => sockets.at(-1);

void test('one shared socket, reconnect from error or close with backoff, keepalive drops a half-open socket', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { subscribeLiveMessages, subscribeLiveStatus } = await import('../lib/live-channel.ts');

  const statuses = [];
  const messagesA = [];
  const messagesB = [];
  const offStatus = subscribeLiveStatus((status) => statuses.push(status));
  const offA = subscribeLiveMessages((message) => messagesA.push(message));
  const offB = subscribeLiveMessages((message) => messagesB.push(message));

  assert.equal(sockets.length, 1, 'every subscriber shares one socket per page');
  assert.equal(latest().url, 'wss://work-os.example.test/api/live?kind=browser');
  assert.deepEqual(statuses, [{ connected: false, runnerConnected: null }], 'status listeners get the current status immediately');

  // A rejected handshake can fire only 'error' (never 'close') — it must still reconnect, once.
  latest().fail();
  latest().dispatchEvent(new Event('close'));
  t.mock.timers.tick(999);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 2, 'reconnects after 1 s, and only once for error+close');

  latest().fail();
  t.mock.timers.tick(1_999);
  assert.equal(sockets.length, 2);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 3, 'backoff doubles to 2 s');

  latest().open();
  assert.deepEqual(statuses.at(-1), { connected: true, runnerConnected: null });
  latest().receive({ type: 'hello', processes: {}, runnerConnected: true });
  assert.deepEqual(statuses.at(-1), { connected: true, runnerConnected: true });
  latest().receive({ type: 'process_state', process: 'waiting_check', active: true });
  latest().receive({ type: 'pong' });
  assert.deepEqual(messagesA.map((message) => message.type), ['hello', 'process_state'], 'pong is consumed by the keepalive, never delivered');
  assert.deepEqual(messagesB, messagesA);
  latest().receive({ type: 'runner_status', connected: false });
  assert.deepEqual(statuses.at(-1), { connected: true, runnerConnected: false });

  // Keepalive: the exact string the owner DO auto-responds to, answered → socket kept.
  const ownerChannel = readFileSync(new URL('../workers/owner-channel.js', import.meta.url), 'utf8');
  assert.match(ownerChannel, /const PING = JSON\.stringify\(\{ type: 'ping' \}\);/);
  t.mock.timers.tick(30_000);
  assert.deepEqual(latest().sent, [JSON.stringify({ type: 'ping' })]);
  latest().receive({ type: 'pong' });
  t.mock.timers.tick(10_000);
  assert.equal(sockets.length, 3, 'an answered ping keeps the socket');

  // No pong within 10 s → half-open socket is dropped and replaced; backoff was reset by the open.
  t.mock.timers.tick(20_000);
  assert.equal(latest().sent.length, 2);
  t.mock.timers.tick(10_000);
  assert.equal(sockets[2].closed, true);
  assert.deepEqual(statuses.at(-1), { connected: false, runnerConnected: null });
  t.mock.timers.tick(1_000);
  assert.equal(sockets.length, 4);

  // A dropped open connection fires 'close' → reconnect too.
  latest().open();
  latest().drop();
  t.mock.timers.tick(1_000);
  assert.equal(sockets.length, 5);

  // Last subscriber gone → socket closed, no further reconnects.
  latest().open();
  offA();
  offB();
  t.mock.timers.tick(0);
  assert.equal(latest().closed, false, 'a remaining status subscriber keeps the socket');
  offStatus();
  t.mock.timers.tick(0);
  assert.equal(latest().closed, true);
  latest().drop();
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 5);
});

void test('server-sync stops the blind revision poll while the live channel is open and resumes it when it drops', () => {
  const sync = readFileSync(new URL('../components/server-sync.tsx', import.meta.url), 'utf8');
  assert.match(sync, /import \{ subscribeLiveMessages, subscribeLiveStatus \} from '@\/lib\/live-channel';/);
  assert.match(sync, /if \(liveConnected\) \{\s*schedulePoll\(SERVER_SYNC_IDLE_MAX_MS\);\s*return;\s*\}/);
  assert.match(sync, /const onLiveMessage = \(\) => scheduleWake\('live', 'all'\);/);
  assert.match(sync, /if \(!connected\) \{\s*pollDelay = SERVER_SYNC_IDLE_MIN_MS;\s*schedulePoll\(pollDelay\);/);
  assert.match(sync, /unsubscribeLiveMessages\(\);\s*unsubscribeLiveStatus\(\);/);
});

void test('the Waiting-check panel follows the live channel and polls only as a fallback while it is down', () => {
  const workspace = readFileSync(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /message\.type==='process_state'&&message\.process==='waiting_check'\)applyWaitingCheckView\(parseWaitingCheckView\(message\)\)/);
  assert.match(workspace, /else if\(message\.type==='runner_status'\)void refreshWaitingCheck\(\)/);
  assert.match(workspace, /queue!=='waiting'\|\|liveStatus\.connected\)return;\s*\/\/ Fallback only while the live channel is down/);
  assert.match(workspace, /liveStatus\.connected&&liveStatus\.runnerConnected===true\s*\? \{\.\.\.waitingCheck,runnerSeenAt:Math\.floor\(clock\/1000\)\}/);
  assert.match(workspace, /<WhatsappWaitingCheckPanel view=\{waitingCheckView\}/);
  assert.match(workspace, /message\.process!=='autopost'\)return;\s*if\(message\.status==='running'\|\|message\.status==='released'\)return;\s*invalidateQueueCache\('whatsapp'\);/);
});

void test('the runner keeps its live channel alive with the same auto-response ping and drops a half-open socket', () => {
  const runner = readFileSync(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /const WS_KEEPALIVE_MS=30000;/);
  assert.match(runner, /const WS_PING=JSON\.stringify\(\{type:'ping'\}\);/);
  assert.match(runner, /if\(awaitingPong\)\{[^}]*onDown\(\);return;\}/);
  assert.match(runner, /if\(event\.data===WS_PONG\)\{awaitingPong=false;return;\}/);
  assert.match(runner, /if\(keepalive\)clearInterval\(keepalive\);/);
});

void test('the runner tray returns to ready once the pushed task queue is drained (e.g. after Stop)', () => {
  const runner = readFileSync(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /processingTask=false;[\s\S]{0,260}if\(!incomingTaskQueue\.length&&liveWs&&liveWs\.readyState===WebSocket\.OPEN\)setStatus\('ready','Готовий: підключено до Work OS'\);/);
});

void test('Stop reaches a Waiting check in progress: the runner aborts it before any WhatsApp click', async () => {
  const runner = readFileSync(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8');
  const cdp = readFileSync(new URL('../scripts/whatsapp-web-cdp.mjs', import.meta.url), 'utf8');
  assert.match(runner, /if\(message\.type==='cancel'&&message\.process==='waiting_check'\)\{\s*cancelWaitingCheck\(message\.batchId\);/);
  assert.match(runner, /queued\.taskProcess==='waiting_check'&&queued\.task\?\.batchId===batchId\)incomingTaskQueue\.splice\(index,1\)/);
  assert.match(runner, /currentWaitingCheck\.controller\.abort\(\);/);
  assert.match(runner, /checkWhatsappWaitingInviteViaCdp\(task,\{cdpBaseUrl:whatsappCdp,signal:controller\.signal\}\)/);
  // An aborted check reports nothing and triggers no runtime cooldown.
  assert.match(runner, /if\(controller\.signal\.aborted\)return;\s*if\(outcome\.kind==='blocked'\)\{/);
  // The guarantee: the abort check sits immediately before the click.
  assert.match(cdp, /if \(signal\?\.aborted\) return \{ kind:'blocked', reason:'cancelled', actions \};\s*const observedName = [^\n]*\n\s*const clicked = await clickExactButton/);
  assert.match(cdp, /if \(signal\?\.aborted\) return \{ kind:'blocked', reason:'cancelled' \};\s*await client\.send\('Page\.navigate'/);
  const { toWaitingCheckOutcome } = await import('../scripts/whatsapp-web-cdp.mjs');
  assert.deepEqual(toWaitingCheckOutcome({ kind: 'blocked', reason: 'cancelled' }), { kind: 'blocked', reason: 'cancelled' }, 'a cancelled check is never reported as a problem chat');
});
