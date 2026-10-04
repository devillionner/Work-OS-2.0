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
  assert.doesNotMatch(platform,/for\(const item of queues\)[\s\S]{0,1600}fetch\(`\/api\/chats/);
});

void test('Platforms GET uses queue counters and an index-friendly page order',()=>{
  const route=read('app/api/chats/route.ts');
  const migration=read('migrations/0039_chat_queue_read_model.sql');
  assert.match(route,/FROM chat_queue_counts/);
  assert.match(route,/const totalStatement = search/);
  assert.match(route,/chatListPageStatement\(env\.DB,/);
  const listQuery=read('lib/chats/list-query.ts');
  assert.match(listQuery,/ORDER BY c\.updated_at DESC,c\.id LIMIT 50 OFFSET/);
  // The two-status review queue merges two index-ordered arms instead of sorting the whole queue.
  assert.match(listQuery,/LIMIT \?6\+50\)`;/);
  assert.match(listQuery,/WITH page AS MATERIALIZED \(SELECT id FROM \(\$\{reviewBranch\('waiting'\)\} UNION ALL \$\{reviewBranch\('ready'\)\}\)/);
  // The status must stay visible to the planner; the old `?3='profile_review' OR …` walked all owner chats.
  assert.doesNotMatch(listQuery+route,/AND c\.workflow_status IN \('waiting','ready'\)\) OR c\.workflow_status=\?3/);
  assert.doesNotMatch(route,/ORDER BY published_today ASC,CASE WHEN c\.snoozed_until/);
  assert.match(migration,/CREATE TABLE chat_queue_counts/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_chat_insert/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_chat_move/);
  assert.match(migration,/CREATE TRIGGER chat_queue_counts_profile_insert/);
  assert.match(migration,/CREATE INDEX chats_user_platform_status_updated_idx/);
});

void test('Discovery search is local-first and D1 work stays targeted until explicit confirmation',()=>{
  const runner=read('scripts/chat-discovery-runner.mjs');
  const auth=read('lib/chat-discovery/executor-auth.ts');
  const executor=read('lib/chat-discovery/executor.ts');
  const deploy=read('scripts/deploy-staging.mjs');
  const preview=read('lib/chat-discovery/local-preview.ts');
  assert.match(runner,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  // The local loop is fast (2–5 s) but touches D1 only indirectly: waiting_check/autopost/discovery
  // (commits 3b/3c/3d) moved off this runner's own D1 polling entirely onto the owner Durable
  // Object's live-channel push (commit 3e) — an idle connection reads nothing, regardless of whether
  // Work OS is in use.
  assert.match(runner,/function connectLiveChannel\(\)/);
  assert.doesNotMatch(runner,/CLOUD_AUTOMATION_POLL_MS|cloudDemand/);
  assert.match(auth,/EXECUTOR_HEARTBEAT_SECONDS = 60/);
  assert.match(executor,/sourceAdvanceNeeded: false/);
  assert.doesNotMatch(executor,/SELECT min_members,status FROM chat_discovery_runs/);
  assert.match(executor,/LIMIT \?3`\)\.bind\(userId, now, limit\);/);
  assert.match(executor,/discoveryExecutorQueueStatement\(db, userId, now, limit\)\.all<CandidateTaskRow>\(\)/);
  assert.doesNotMatch(executor,/Math\.max\(limit \* 3, 20\)/);
  // Commit 3d: the per-device HTTP executor route (and the executor_lease_device_id/expires_at claim
  // it used to bridge) is gone entirely — Discovery dispatch now goes through the owner Durable
  // Object (see tests/chat-discovery-route-contract.test.mjs and tests/owner-channel.test.mjs).
  assert.doesNotMatch(executor,/claimDiscoveryExecutorQueue|assertDiscoveryExecutorLease/);
  assert.match(deploy,/if \(fingerprintCheck\.allowed\)/);
  assert.match(deploy,/Skipping remote D1 migration list for this code-only deploy/);
  // One bounded source query per Worker call (was six before the source crawl moved to the browser).
  assert.match(preview,/const batchSize=1;/);
  assert.match(preview,/buildTelegramSearchPlan\(telegramCursor,batchSize\)/);
  assert.match(preview,/maxQueries:batchSize,pageLimit:1/);
  // Invite dedupe is one unique-index lookup per link (platform bound), never a walk over the owner's chats.
  assert.match(preview,/FROM json_each\(\?2\) j CROSS JOIN chats c/);
  assert.doesNotMatch(preview,/normalized_link IN \(SELECT value FROM json_each/);
  const searchStart=preview.indexOf('export async function searchLocalDiscoveryPreview');
  // Only the search step itself must stay write-free; persisting an operator decision is an explicit action.
  const searchEnd=preview.indexOf('export async function',searchStart+1);
  const searchBody=preview.slice(searchStart,searchEnd);
  assert.ok(searchStart>=0&&searchEnd>searchStart);
  assert.doesNotMatch(searchBody,/INSERT INTO/);
  assert.doesNotMatch(searchBody,/UPDATE chat_discovery_runs/);
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
