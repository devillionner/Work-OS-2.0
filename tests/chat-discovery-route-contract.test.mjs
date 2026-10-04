import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Chat Discovery mutation route preserves the browser API contract', async () => {
  const route = await readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8');

  assert.match(route, /readJsonObject\(request, 256 \* 1024\)/);
  assert.match(route, /Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.match(route, /if \(body\.action === 'start'\)/);
  assert.match(route, /if \(body\.action === 'archive-stale-imports'\)/);
  assert.match(route, /event_type='chat_discovery_imported'/);
  assert.match(route, /joined_at IS NULL/);
  assert.match(route, /Очищено: старий автопошук/);
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
  assert.doesNotMatch(route, /pause-waiting-check/);
  assert.doesNotMatch(route, /advanceAutonomousDiscoveryRun/);
});

// Operator decision 2026-10-02: search and qualification never write D1; only «Підтвердити» (confirm) and
// «Архівувати всі» (one batch) do. There is no per-result persist action anymore.
void test('Preview route writes D1 only through confirm and the archive-all batch', async()=>{
  const route=await readFile(new URL('../app/api/chat-discovery/preview/route.ts',import.meta.url),'utf8');
  assert.doesNotMatch(route,/persist-outcome|persistLocalDiscoveryOutcome/);
  assert.match(route,/body\.action==='archive-outcomes'/);
  assert.match(route,/archiveLocalDiscoveryOutcomes\(env\.DB,user\.id,\{items:body\.items\},now\)/);
  assert.match(route,/body\.action==='confirm'/);
  assert.match(route,/body\.action==='telegram-groups'/);
});

void test('operator can archive an unimported saved target without fabricating qualification facts', async()=>{
  const [route,domain]=await Promise.all([
    readFile(new URL('../app/api/chat-discovery/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts',import.meta.url),'utf8'),
  ]);
  assert.match(route,/body\.action === 'archive-candidate'/);
  assert.match(route,/archiveDiscoveryCandidateForOperator/);
  assert.match(domain,/reason_codes_json='\["operator_rejected"\]'/);
  assert.match(domain,/needsExternalLeave:candidate\.membership_state==='joined'/);
});


void test('WhatsApp waiting-check API always answers with JSON and bridges to the owner Durable Object, not D1 leases', async()=>{
  const [route,executor]=await Promise.all([
    readFile(new URL('../app/api/chat-discovery/waiting-check/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts',import.meta.url),'utf8'),
  ]);
  assert.match(route,/function json\(value: unknown, status = 200\)/);
  assert.match(route,/WhatsApp waiting-check action failed/);
  assert.match(route,/Не вдалося запустити перевірку WhatsApp/);
  assert.match(route,/env\.OWNER_CHANNEL\.get\(env\.OWNER_CHANNEL\.idFromName\(userId\)\)/);
  assert.doesNotMatch(route,/claimWaitingWhatsAppCheck|startWaitingWhatsAppCheck/);
  // The old per-device HTTP executor bridge for this process is gone now that state lives in the DO
  // and the runner protocol moves to WebSocket (commit 3e); the Discovery executor's own retired-row
  // guard below is unrelated and still applies.
  assert.doesNotMatch(executor,/ensureWaitingWhatsAppCandidates/);
  assert.match(executor,/NOT \(\$\{RETIRED_WAITING_CHECK_CANDIDATE_SQL\}\)/);
});

void test('the retired HTTP waiting-check executor route is gone, not left to silently 404-bridge the old protocol', async()=>{
  await assert.rejects(readFile(new URL('../app/api/chat-discovery/waiting-check/executor/route.ts',import.meta.url),'utf8'));
});


void test('Waiting executor does not require the historical pending-recheck column', async()=>{
  const [executor,inspection]=await Promise.all([
    readFile(new URL('../lib/chat-discovery/executor.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/inspection.ts',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(executor,/executor_next_check_at/);
  assert.doesNotMatch(inspection,/executor_next_check_at/);
  assert.doesNotMatch(executor,/checked_at<0/);
});
