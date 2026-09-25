import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Chat Discovery mutation route preserves the browser API contract', async () => {
  const route = await readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8');

  assert.match(route, /readJsonObject\(request, 256 \* 1024\)/);
  assert.match(route, /Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.match(route, /if \(body\.action === 'start'\)/);
  assert.match(route, /return json\(\{ run \}\)/);
  assert.match(route, /if \(body\.action === 'cancel'\)/);
  assert.match(route, /Number\.isSafeInteger\(body\.version\)/);
  assert.match(route, /cancelDiscoveryRun\(env\.DB, user\.id, body\.runId, Number\(body\.version\), now\)/);
  assert.match(route, /if \(url\.searchParams\.get\('executor'\) === '1'\)/);
  assert.match(route, /readDiscoveryExecutorQueue\(env\.DB, user\.id, url\.searchParams\.get\('limit'\)\)/);
  assert.match(route, /if \(body\.action === 'import'\)/);
  assert.match(route, /handoffDiscoveryCandidate\(env\.DB, user\.id, body\.candidateId, Number\(body\.version\), now\)/);
  assert.match(route, /if \(body\.action === 'executor-leave'\)/);
  assert.match(route, /completeDiscoveryExternalLeave\(env\.DB, user\.id/);
  assert.match(route, /Source search тепер працює локально/);
  assert.match(route, /Telegram source preview тепер локальний/);
  assert.doesNotMatch(route, /body\.action === 'handoff'/);
  assert.doesNotMatch(route, /body\.expectedVersion/);
});

void test('Chat Discovery rejects malformed versioned mutations before domain calls', async () => {
  const route = await readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8');

  assert.match(route, /typeof body\.candidateId !== 'string'/);
  assert.match(route, /Number\.isSafeInteger\(body\.version\)/);
  assert.match(route, /typeof body\.runId !== 'string'/);
  assert.match(route, /throw new DiscoveryError\('Невідома дія\.'\)/);
});


void test('dedicated executor bridge leases tasks to the authenticated device before callbacks', async () => {
  const route = await readFile(new URL('../app/api/chat-discovery/executor/route.ts', import.meta.url), 'utf8');
  assert.match(route, /claimDiscoveryExecutorQueue\(env\.DB, executor\.userId, executor\.deviceId/);
  assert.match(route, /assertDiscoveryExecutorLease\(env\.DB, executor\.userId, executor\.deviceId/);
  assert.match(route, /requireTargetVerification: true/);
  assert.match(route, /executorDeviceId: executor\.deviceId/);
  assert.match(route, /targetVerified: body\.targetVerified/);
  assert.match(route, /body\.action === 'advance-discovery'/);
  assert.match(route, /Source crawl moved to browser-local preview/);
  assert.doesNotMatch(route, /advanceAutonomousDiscoveryRun/);
});
