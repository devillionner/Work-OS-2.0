import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

void test('D1-backed global sync uses adaptive idle and failure backoff instead of a fixed interval',()=>{
  const sync=read('components/server-sync.tsx');
  assert.match(sync,/SERVER_SYNC_ACTIVE_MS = 10_000/);
  assert.match(sync,/SERVER_SYNC_IDLE_MIN_MS = 30_000/);
  assert.match(sync,/SERVER_SYNC_IDLE_MAX_MS = 60_000/);
  assert.match(sync,/SERVER_SYNC_ERROR_MAX_MS = 300_000/);
  assert.match(sync,/failureDelay === 0/);
  assert.match(sync,/Math\.min\(SERVER_SYNC_ERROR_MAX_MS, failureDelay \* 2\)/);
  assert.doesNotMatch(sync,/setInterval/);
});

void test('Platforms never speculatively prefetches sibling D1 queues',()=>{
  const platform=read('components/platform-workspace.tsx');
  assert.doesNotMatch(platform,/prefetching/);
  assert.doesNotMatch(platform,/cacheEpoch/);
  assert.doesNotMatch(platform,/for\(const item of queues\)[\s\S]{0,1600}fetch\(\`\/api\/chats/);
});

void test('Discovery executor and staging deploy retain quota-safe guards',()=>{
  const runner=read('scripts/chat-discovery-runner.mjs');
  const auth=read('lib/chat-discovery/executor-auth.ts');
  const executor=read('lib/chat-discovery/executor.ts');
  const deploy=read('scripts/deploy-staging.mjs');
  assert.match(runner,/IDLE_POLL_MIN_MS=15000/);
  assert.match(runner,/IDLE_POLL_MAX_MS=60000/);
  assert.match(auth,/EXECUTOR_HEARTBEAT_SECONDS = 60/);
  assert.match(executor,/readDiscoveryExecutorQueue\(db, userId, limit, now\)/);
  assert.match(deploy,/if \(fingerprintCheck\.allowed\)/);
  assert.match(deploy,/Skipping remote D1 migration list for this code-only deploy/);
});

void test('workday and Viber safe-mode polling have bounded D1 backoff and no fixed request interval',()=>{
  const workday=read('components/workday-card.tsx');
  const library=read('components/library-workspace.tsx');
  const route=read('app/api/messenger-automation/route.ts');
  assert.match(workday,/SYNC_ACTIVE_MS = 5_000/);
  assert.match(workday,/SYNC_IDLE_MIN_MS = 15_000/);
  assert.match(workday,/SYNC_IDLE_MAX_MS = 60_000/);
  assert.match(workday,/SYNC_ERROR_MAX_MS = 300_000/);
  assert.doesNotMatch(workday,/setInterval\(\(\) => \{[\s\S]{0,240}refreshWorkday/);
  assert.match(library,/VIBER_JOB_POLL_ACTIVE_MS=5_000/);
  assert.match(library,/VIBER_JOB_POLL_IDLE_MAX_MS=60_000/);
  assert.match(library,/VIBER_JOB_POLL_ERROR_MAX_MS=300_000/);
  assert.match(library,/messenger-automation\?viberJobId=/);
  assert.doesNotMatch(library,/setInterval\(.*messenger-automation/s);
  assert.match(route,/viberJobId/);
  assert.match(route,/readViberSafeNoteJob\(env\.DB,user\.id,viberJobId\)/);
});
