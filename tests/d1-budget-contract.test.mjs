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
