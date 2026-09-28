import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');

void test('runner consumes paired executor tasks and posts guarded callbacks',()=>{
  assert.match(source,/WORK_OS_EXECUTOR_TOKEN/);
  assert.ok(source.includes('Authorization:'));
  assert.match(source,/\/api\/chat-discovery\/executor\?limit=\$\{EXECUTOR_QUEUE_LIMIT\}/);
  assert.match(source,/action:'inspect'/);
  assert.match(source,/action:'executor-leave'/);
  assert.match(source,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
});
void test('runner performs local WhatsApp preflight before any D1-backed executor polling',()=>{
  assert.match(source,/readWorkOsLocalDiscoveryTaskViaCdp/);
  assert.match(source,/writeWorkOsLocalDiscoveryResultViaCdp/);
  assert.match(source,/processLocalPreflight/);
  assert.match(source,/if\(!token\)return 'idle'/);
  assert.match(source,/approval_required/);
  const local=source.indexOf('readWorkOsLocalDiscoveryTaskViaCdp');
  const d1=source.indexOf('api(\`/api/chat-discovery/executor?limit=');
  assert.ok(local>0&&d1>local);
});

void test('runner automates verified WhatsApp leave via CDP and retains operator-confirmed fallback',()=>{
  assert.match(source,/leaveWhatsappTaskViaCdp/);
  assert.match(source,/Verified WhatsApp leave accepted by Work OS/);
  assert.match(source,/leave automation stopped fail-closed/);
  assert.match(source,/if\(!process\.stdin\.isTTY\)return 'idle'/);
});

void test('runner requires operator confirmation before reporting external leave',()=>{
  const prompt=source.indexOf('Confirm only AFTER you actually left the chat');
  const callback=source.lastIndexOf("action:'executor-leave'");
  assert.ok(prompt>0&&callback>prompt);
  assert.match(source,/xdg-open/);
});

void test('runner verifies the exact messenger target before inspection or leave callbacks',()=>{
  const targetPrompt=source.indexOf('Exact target verified as');
  const inspectCallback=source.indexOf("action:'inspect'");
  const leaveCallback=source.indexOf("action:'executor-leave'");
  assert.ok(targetPrompt>0&&inspectCallback>targetPrompt);
  assert.match(source,/targetVerified:true/);
  assert.ok(leaveCallback>targetPrompt);
  assert.match(source,/leave skipped fail-closed/);
});

void test('runner fails closed on ambiguous membership and requires a confirmed join for join tasks',()=>{
  assert.match(source,/function membershipState/);
  assert.match(source,/membership_not_confirmed/);
  assert.match(source,/task\.action==='join_and_inspect'&&membership!=='joined'/);
  assert.match(source,/join_not_confirmed/);
  const guard=source.indexOf("reason:'join_not_confirmed'");
  const inspected=source.indexOf("status:'inspected'");
  assert.ok(guard>0&&inspected>guard);
});


void test('runner uses optional WhatsApp Web CDP automation but sends no callback for ambiguous browser state',()=>{
  assert.match(source,/WORK_OS_WHATSAPP_CDP/);
  assert.match(source,/inspectWhatsappTaskViaCdp/);
  assert.match(source,/automation stopped fail-closed/);
  assert.match(source,/if\(inspection\.kind==='blocked'\)/);
  assert.match(source,/toWhatsAppWebInviteUrl/);
});


void test('runner claims WhatsApp autopost only after Discovery messenger tasks and posts a confirmed-send callback',()=>{
  assert.match(source,/\/api\/messenger-automation\/executor\?platform=whatsapp/);
  assert.match(source,/sendWhatsappAutopostViaCdp/);
  assert.match(source,/complete-whatsapp-autopost/);
  assert.match(source,/sendConfirmed:true/);
  assert.match(source,/WhatsApp autopost stopped fail-closed/);
  assert.match(source,/Confirmed WhatsApp autopost accepted by Work OS/);
});

void test('runner never source-crawls through D1 and keeps bounded idle queue polling',()=>{
  assert.match(source,/const TASK_POLL_MS=3000/);
  assert.match(source,/const IDLE_POLL_MIN_MS=15000/);
  assert.match(source,/const IDLE_POLL_MAX_MS=60000/);
  assert.match(source,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.match(source,/Math\.min\(IDLE_POLL_MAX_MS,idleDelayMs\*2\)/);
  assert.match(source,/Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP/);
  assert.match(source,/WHATSAPP_RUNTIME_COOLDOWN_MS=300000/);
  assert.match(source,/backing off until the browser adapter is available/);
});


void test('non-interactive runner fails before API polling without a WhatsApp runtime and transient CDP state pauses automated messenger work',()=>{
  const startupGuard=source.indexOf('Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP');
  const firstApi=source.indexOf('api(`/api/chat-discovery/executor?limit=${EXECUTOR_QUEUE_LIMIT}`)');
  assert.ok(startupGuard>0&&firstApi>startupGuard);
  assert.match(source,/WHATSAPP_RUNTIME_TRANSIENT_REASONS\.has\(automated\.reason\)/);
  assert.match(source,/markWhatsappRuntimeBlocked\('cdp_unavailable'\)/);
  assert.match(source,/clearWhatsappRuntimeBlock\(\)/);
});


void test('runner can read the one-time executor token from Wayland clipboard without putting the secret in argv',()=>{
  assert.match(source,/--token-from-clipboard/);
  assert.match(source,/execFileSync\('wl-paste',\['--no-newline'\]/);
  assert.match(source,/execFileSync\('wl-copy',\['--clear'\]/);
  assert.match(source,/Executor token loaded from clipboard/);
  assert.doesNotMatch(source,/console\.log\(\s*token\s*\)|console\.log\(`[^`]*\$\{token\}/i);
});


void test('runner can bootstrap its token from the exact Work OS page over local CDP',()=>{
  assert.match(source,/--token-from-work-os-page/);
  assert.match(source,/readWorkOsExecutorTokenViaCdp/);
  assert.match(source,/Executor token loaded from the Work OS page through local CDP/);
  assert.match(source,/requires WORK_OS_URL and local WORK_OS_WHATSAPP_CDP/);
});


void test('runner skips a locally blocked candidate instead of starving the executor queue',()=>{
  assert.match(source,/const EXECUTOR_QUEUE_LIMIT=3/);
  assert.match(source,/const TASK_BLOCK_COOLDOWN_MS=300000/);
  assert.match(source,/const taskBlockedUntil=new Map/);
  assert.match(source,/queuedTasks\.find\(item=>!taskIsLocallyBlocked\(item\)\)/);
  assert.match(source,/markTaskBlocked\(task,inspection\.reason\)/);
  assert.match(source,/another candidate may continue/);
  assert.doesNotMatch(source,/executor\?limit=20/);
});


void test('source topic cannot substitute factual WhatsApp audience during local preflight',()=>{
  assert.match(source,/const topic=result\.topicMatch\|\|'unknown'/);
  assert.doesNotMatch(source,/topic=result\.topicMatch\|\|task\.topicMatch/);
  assert.doesNotMatch(source,/!result\.topicMatch&&task\.topicMatch==='match'/);
});

void test('retry-later skips only the affected local candidate with short cooldown',()=>{
  assert.match(source,/result\.reason==='whatsapp_join_retry_later'/);
  assert.match(source,/decision:'skipped'/);
  assert.match(source,/reasonCodes:\['whatsapp_join_retry_later'\]/);
  assert.match(source,/LOCAL_RETRY_LATER_COOLDOWN_MS=15000/);
  assert.doesNotMatch(source,/markWhatsappRuntimeBlocked\('whatsapp_join_retry_later'\)/);
});


void test('local retry-later skips only that invite and does not globally freeze WhatsApp preflight',()=>{
  assert.match(source,/decision:'skipped',reasonCodes:\['whatsapp_join_retry_later'\]/);
  assert.doesNotMatch(source,/LOCAL_RETRY_LATER_COOLDOWN_MS/);
  assert.match(source,/continuing with the next candidate/);
});

void test('background runner can acquire the Work OS executor token after Opera opens later',()=>{
  assert.match(source,/let token=await resolveExecutorToken\(\)/);
  assert.match(source,/async function refreshExecutorTokenIfNeeded\(\)/);
  assert.match(source,/TOKEN_REFRESH_MS=60000/);
});


void test('a single slow WhatsApp page cannot trap the browser-local queue forever',()=>{
  assert.match(source,/inspected\.reason==='page_not_ready'/);
  assert.match(source,/decision:'skipped',reasonCodes:\['page_not_ready'\]/);
  assert.match(source,/LOCAL_PAGE_RECOVERY_MS=5000/);
  assert.match(source,/allowing 5s recovery before the next candidate/);
});


void test('unknown factual qualification is deferred instead of rejected or used as a destructive leave reason',()=>{
  assert.match(source,/decision:incomplete\?'incomplete'/);
  assert.match(source,/qualification_incomplete/);
  assert.match(source,/INCOMPLETE_QUALIFICATION_COOLDOWN_MS=60000/);
  assert.match(source,/keeping it queued and continuing with another candidate/);
});

void test('local Discovery can skip temporarily blocked candidates and continue the queue',()=>{
  assert.match(source,/skipCandidateIds=\[\.\.\.taskBlockedUntil\.entries\(\)\]/);
  assert.match(source,/PAGE_RECOVERY_COOLDOWN_MS=15000/);
});


void test('local Discovery can refill sources while WhatsApp qualification is in flight',()=>{
  assert.match(source,/let localSourceInFlight=null/);
  assert.match(source,/startLocalSourceRefill\(local\)/);
  assert.match(source,/if\(local\.task\)return processLocalPreflight\(local\.task\)/);
});


void test('local Discovery keeps a local source pump filled while WhatsApp runs',()=>{
  assert.match(source,/while\(local\?\.active===true&&local\.sourceExhausted!==true&&Number\(local\.queuedCount\|\|0\)<LOCAL_SOURCE_TARGET_QUEUE\)/);
  assert.match(source,/startLocalSourceRefill\(local\);/);
  assert.doesNotMatch(source,/await startLocalSourceRefill\(local\)/);
});


void test('local Discovery rejects impossible candidates before join',()=>{
  assert.match(source,/queryWhatsappInviteViaCdp/);
  assert.match(source,/Invite rejected before join:/);
  assert.match(source,/pre\.memberCount<minMembers/);
  assert.match(source,/pre\.approvalRequired===true/);
  assert.match(source,/pre\.canWrite===false/);
});

void test('source cooldown is deferred without advancing cursor and local queue can fill ahead',()=>{
  assert.match(source,/LOCAL_SOURCE_TARGET_QUEUE=30/);
  assert.match(source,/batch\.deferred===true/);
  assert.match(source,/without advancing cursor/);
  assert.match(source,/queuedCount\|\|0\)<LOCAL_SOURCE_TARGET_QUEUE/);
});

void test('local Discovery metadata-screens before any heavy WhatsApp invite UI',()=>{
  const start=source.indexOf('async function processLocalPreflight');
  const end=source.indexOf('async function resolveLocalSourceSeedData',start);
  const process=source.slice(start,end);
  assert.match(source,/METADATA_RETRY_COOLDOWN_MS=60000/);
  assert.match(source,/METADATA_INCOMPLETE_COOLDOWN_MS=60000/);
  assert.match(process,/metadata_member_count_unknown/);
  assert.match(process,/deferred so another candidate can continue/);
  assert.ok(process.indexOf('queryWhatsappInviteViaCdp')<process.indexOf('inspectWhatsappTaskViaCdp'));
});
