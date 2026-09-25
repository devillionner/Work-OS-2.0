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

void test('Platforms GET uses queue counters and an index-friendly page order',()=>{
  const route=read('app/api/chats/route.ts');
  const migration=read('migrations/0039_chat_queue_read_model.sql');
  assert.match(route,/FROM chat_queue_counts/);
  assert.match(route,/const totalStatement = search/);
  assert.match(route,/ORDER BY c\.updated_at DESC,c\.id LIMIT 50 OFFSET/);
  assert.doesNotMatch(route,/ORDER BY published_today ASC,CASE WHEN c\.snoozed_until/);
  assert.match(migration,/CREATE TABLE chat_queue_counts/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_chat_insert/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_chat_move/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_profile_insert/);
  assert.match(migration,/CREATE INDEX chats_user_platform_status_updated_idx/);
});

void test('Discovery executor is persistence-only for confirmed candidates and staging deploy retains quota guards',()=>{
  const runner=read('scripts/chat-discovery-runner.mjs');
  const auth=read('lib/chat-discovery/executor-auth.ts');
  const executor=read('lib/chat-discovery/executor.ts');
  const deploy=read('scripts/deploy-staging.mjs');
  const preview=read('lib/chat-discovery/local-preview.ts');
  assert.match(runner,/TASK_POLL_MS=3000/);
  assert.match(runner,/EXECUTOR_QUEUE_LIMIT=3/);
  assert.match(runner,/TASK_BLOCK_COOLDOWN_MS=300000/);
  assert.match(runner,/WHATSAPP_RUNTIME_COOLDOWN_MS=300000/);
  assert.match(runner,/IDLE_POLL_MIN_MS=15000/);
  assert.match(runner,/IDLE_POLL_MAX_MS=60000/);
  assert.doesNotMatch(runner,/advance-discovery/);
  assert.doesNotMatch(runner,/SOURCE_ADVANCE_MS/);
  assert.match(auth,/EXECUTOR_HEARTBEAT_SECONDS = 60/);
  assert.match(executor,/readDiscoveryExecutorQueue\(db, userId, limit, now\)/);
  assert.match(executor,/LIMIT \?3`\)\.bind\(userId, now, limit\)\.all<CandidateTaskRow>\(\)/);
  assert.doesNotMatch(executor,/Math\.max\(limit \* 3, 20\)/);
  assert.match(deploy,/if \(fingerprintCheck\.allowed\)/);
  assert.match(deploy,/Skipping remote D1 migration list for this code-only deploy/);
  assert.match(preview,/normalized_link IN \(SELECT value FROM json_each\(\?2\)\)/);
  assert.doesNotMatch(preview,/LIMIT 10001/);
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


void test('high-cost workspace reads use revision-aware Worker cache',()=>{
  const helper=read('lib/revision-cache.ts');
  assert.match(helper,/readSyncRevision/);
  assert.match(helper,/caches\.default/);
  assert.match(helper,/X-Work-OS-Cache/);
  for(const path of [
    'app/api/chats/route.ts',
    'app/api/analytics/route.ts',
    'app/api/analytics/overview/route.ts',
    'app/api/library/route.ts',
    'app/api/reports/route.ts',
    'app/api/leads/route.ts',
  ]) {
    const source=read(path);
    assert.match(source,/revisionCacheRequest/);
    assert.match(source,/matchRevisionJson/);
    assert.match(source,/putRevisionJson/);
  }
});
