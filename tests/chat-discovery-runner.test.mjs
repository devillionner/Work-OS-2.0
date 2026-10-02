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
void test('runner services D1-backed pending checks while local Discovery remains active',()=>{
  assert.match(source,/readWorkOsLocalDiscoveryTaskViaCdp/);
  assert.match(source,/writeWorkOsLocalDiscoveryResultViaCdp/);
  assert.match(source,/processLocalPreflight/);
  assert.match(source,/CLOUD_AUTOMATION_POLL_MS=15000/);
  assert.match(source,/runD1BackedTaskOnce/);
  assert.match(source,/cloudPolled=true/);
  assert.match(source,/approval_required/);
  const scheduler=source.indexOf('runD1BackedTaskOnce');
  const local=source.indexOf('readWorkOsLocalDiscoveryTaskViaCdp',source.indexOf('async function runOnce'));
  assert.ok(scheduler>0&&local>scheduler);
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


void test('runner fairly alternates pending checks and WhatsApp autopost with confirmed-send callbacks',()=>{
  assert.match(source,/\/api\/messenger-automation\/executor\?platform=whatsapp/);
  assert.match(source,/sendWhatsappAutopostViaCdp/);
  assert.match(source,/complete-whatsapp-autopost/);
  assert.match(source,/sendConfirmed:true/);
  assert.match(source,/const autopostFirst=preferAutopost/);
  assert.match(source,/preferAutopost=!preferAutopost/);
  assert.match(source,/WhatsApp autopost stopped fail-closed/);
  assert.match(source,/Confirmed WhatsApp autopost accepted by Work OS/);
});

void test('runner never source-crawls through D1 and keeps bounded idle queue polling',()=>{
  assert.match(source,/const TASK_POLL_MS=3000/);
  assert.match(source,/const IDLE_POLL_MIN_MS=2000/);
  assert.match(source,/const IDLE_POLL_MAX_MS=5000/);
  assert.match(source,/const CLOUD_AUTOMATION_POLL_MS=15000/);
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
  assert.match(source,/const EXECUTOR_QUEUE_LIMIT=1/);
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

void test('background runner can acquire the Work OS executor token after Opera opens later',()=>{
  assert.match(source,/let token=await resolveExecutorToken\(\)/);
  assert.match(source,/async function refreshExecutorTokenIfNeeded\(\)/);
  assert.match(source,/TOKEN_REFRESH_MS=60000/);
});

void test('runner re-reads a revoked executor token from the Work OS page instead of retrying it forever',()=>{
  assert.match(source,/response\.status===401&&process\.argv\.includes\('--token-from-work-os-page'\)\)\{token='';nextTokenResolveAt=0;\}/);
});


void test('local Discovery can skip temporarily blocked candidates and continue the queue',()=>{
  assert.match(source,/skipCandidateIds=\[\.\.\.taskBlockedUntil\.entries\(\)\]/);
  assert.match(source,/PAGE_RECOVERY_COOLDOWN_MS=15000/);
});


void test('runner recovers a WhatsApp home stuck on message loading without stealing focus',()=>{
  assert.match(source,/health\.loading===true/);
  assert.match(source,/whatsappLoadingSignals\+=1/);
  assert.match(source,/WHATSAPP_LOADING_RELOAD_AFTER=3/);
  assert.match(source,/resetWhatsappPageViaCdp/);
  assert.match(source,/reloaded home and will resume after cooldown/);
});

void test('local Discovery idle polling reacts within a few seconds',()=>{
  assert.match(source,/IDLE_POLL_MIN_MS=2000/);
  assert.match(source,/IDLE_POLL_MAX_MS=5000/);
});

void test('local source crawl batches three cursors including bootstrap',()=>{
  assert.match(source,/const width=3/);
  assert.doesNotMatch(source,/const width=start>=15\?3:1/);
});

void test('local source refill releases its lock after one deterministic step',()=>{
  const start=source.indexOf('function startLocalSourceRefill');
  const end=source.indexOf('async function refillLocalSourceOnce',start);
  const block=source.slice(start,end);
  assert.match(block,/refillLocalSourceOnce\(initialLocal\)/);
  assert.match(block,/finally\(\(\)=>\{localSourceInFlight=null;\}\)/);
  assert.doesNotMatch(block,/while\(/);
});

void test('source refill has only a short idle gap',()=>{
  assert.match(source,/LOCAL_SOURCE_MIN_MS=500/);
});

void test('waiting checks are operator batches claimed one chat at a time and runtime problems release the chat',()=>{
  const start=source.indexOf('async function runWaitingCheckOnce');
  const block=source.slice(start,source.indexOf('async function runDiscoveryExecutorOnce',start));
  assert.match(block,/api\('\/api\/chat-discovery\/waiting-check\/executor'\)/);
  assert.match(block,/checkWhatsappWaitingInviteViaCdp\(task/);
  assert.match(block,/action:'release'/);
  assert.match(block,/action:'complete'/);
  assert.doesNotMatch(source,/pause-waiting-check/);
  const d1=source.slice(source.indexOf('async function runD1BackedTaskOnce'));
  assert.ok(d1.indexOf('runWaitingCheckOnce')<d1.indexOf('runWhatsAppAutopostOnce'));
});

void test('runner reads D1 only on the cloud cadence and backs off to one poll a minute when idle',()=>{
  const runOnce=source.slice(source.indexOf('async function runOnce'),source.indexOf("console.log('Work OS Discovery runner started."));
  assert.equal(runOnce.split('runD1BackedTaskOnce()').length-1,1);
  assert.match(source,/const CLOUD_AUTOMATION_IDLE_MAX_MS=60000/);
  assert.match(runOnce,/cloudAutomationDelayMs=Math\.min\(CLOUD_AUTOMATION_IDLE_MAX_MS,cloudAutomationDelayMs\*2\)/);
  assert.match(runOnce,/if\(cloudOutcome\)\{\s*lastCloudWorkAt=Date\.now\(\);\s*cloudAutomationDelayMs=CLOUD_AUTOMATION_POLL_MS;/);
});

void test('runner polls Work OS only while the site is in use or it still has work, and never when the site is idle',()=>{
  const runOnce=source.slice(source.indexOf('async function runOnce'),source.indexOf("console.log('Work OS Discovery runner started."));
  assert.match(runOnce,/&&await cloudDemand\(\)\)\{/);
  assert.match(source,/const USER_ACTIVE_WINDOW_MS=15\*60_000/);
  assert.match(source,/const WORK_GRACE_MS=5\*60_000/);
  assert.match(source,/readWorkOsLastActivityViaCdp\(baseUrl/);
  assert.match(source,/wanted=userActive\|\|Date\.now\(\)-lastCloudWorkAt<WORK_GRACE_MS/);
  assert.match(source,/setStatus\('paused'/);
});

void test('runner never interrupts a WhatsApp message sync and gives Discovery operations time to wait it out',()=>{
  assert.match(source,/'page_not_ready','whatsapp_messages_loading'\]\)/);
  assert.match(source,/const cooldown=reason==='whatsapp_messages_loading'\?WHATSAPP_LOADING_COOLDOWN_MS:WHATSAPP_RUNTIME_COOLDOWN_MS/);
  assert.match(source,/&&Date\.now\(\)-whatsappLoadingSince>=WHATSAPP_STUCK_LOADING_MS/);
  assert.match(source,/const WHATSAPP_STUCK_LOADING_MS=180000/);
  assert.match(source,/inspectWhatsappTaskViaCdp\(task,\{cdpBaseUrl:whatsappCdp,timeoutMs:DISCOVERY_WHATSAPP_TIMEOUT_MS\}\)/);
  assert.match(source,/leaveWhatsappTaskViaCdp\(task,\{cdpBaseUrl:whatsappCdp,timeoutMs:DISCOVERY_WHATSAPP_TIMEOUT_MS\}\)/);
});

// Local Discovery after the 2026-09-29 rewrite: every per-candidate problem (retry later, slow page,
// metadata gaps, incomplete facts) goes through one bounded deferral instead of reason-specific branches.
const localPreflight=source.slice(source.indexOf('async function processLocalPreflight('),source.indexOf('async function resolveLocalSourceSeedData'));

void test('a failing or slow local candidate is deferred alone with bounded retries and never freezes WhatsApp',()=>{
  const defer=source.slice(source.indexOf('async function deferLocalPreflight'),source.indexOf('const FRESH_JOIN_MANUAL_REVIEW_REASONS'));
  assert.match(defer,/if\(Number\(checkpoint\.attempts\)>=3\)\{/);
  assert.match(defer,/decision:'unavailable',reasonCodes:\['retry_exhausted',reason\]/);
  assert.match(defer,/markTaskBlocked\(task,reason,15000\)/);
  assert.match(source,/const skipCandidateIds=\[\.\.\.taskBlockedUntil\.entries\(\)\]/);
  assert.match(source,/readWorkOsLocalDiscoveryTaskViaCdp\(baseUrl,\{cdpBaseUrl:whatsappCdp,skipCandidateIds\}\)/);
  assert.doesNotMatch(source,/markWhatsappRuntimeBlocked\('whatsapp_join_retry_later'\)/);
  assert.match(localPreflight,/return deferLocalPreflight\(task,joined\.reason\|\|'direct_join_failed',pre\)/);
});

void test('unknown factual qualification is deferred, then closed as unavailable — never as a rejection or leave reason',()=>{
  assert.match(source,/return \{decision:incomplete\?'incomplete':reasons\.length\?'rejected':'target'/);
  assert.match(source,/return deferLocalPreflight\(task,'qualification_incomplete',result\)/);
  assert.match(source,/decision:'unavailable',\s*reasonCodes:\['qualification_incomplete',\.\.\.evaluated\.reasonCodes\]/);
});

void test('local Discovery screens invite metadata and rejects impossible candidates before any join',()=>{
  const query=localPreflight.indexOf('queryWhatsappInviteViaCdp(task');
  const reject=localPreflight.indexOf("return completeLocalPreflight(task,{decision:'rejected',reasonCodes:reasons");
  const join=localPreflight.indexOf('joinWhatsappInviteViaRuntime(task');
  assert.ok(query>0&&reject>query&&join>reject);
  assert.match(localPreflight,/pre\.memberCount<minMembers\)reasons\.push\('too_few_members'\)/);
  assert.match(localPreflight,/pre\.canWrite===false\)reasons\.push\('cannot_write'\)/);
  assert.match(localPreflight,/if\(pre\.approvalRequired===true\)\{\s*return completeLocalPreflight\(task,\{decision:'skipped',reasonCodes:\['approval_required'\]/);
});

void test('local Discovery joins through the WhatsApp runtime and uses the invite UI only as a bounded fallback',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(adapter,/export async function joinWhatsappInviteViaRuntime/);
  assert.match(adapter,/WAWebGroupInviteJob/);
  assert.match(adapter,/export async function leaveWhatsappGroupViaRuntime/);
  // The UI adapter runs only on the last metadata attempt or when the runtime join module is unavailable.
  assert.match(localPreflight,/if\(Number\(task\.checkpoint\?\.attempts\)>=3\)\{[\s\S]*?inspectWhatsappTaskViaCdp\(task/);
  assert.match(localPreflight,/\['direct_join_unavailable','joined_identity_missing'\]\.includes\(joined\.reason\)/);
  assert.match(localPreflight,/Do not perform a second join after a timeout if WhatsApp may have accepted it/);
});

void test('the local source pump refills without blocking WhatsApp work and skips a deferred source step',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  // Deferred (skipped) candidates do not count as queued, so they cannot starve the source refill.
  assert.match(adapter,/queuedCount:candidates\.filter\(item=>item\?\.preflightState==='queued'&&!results\[item\?\.id\]&&!skipped\.has\(item\?\.id\)\)\.length/);
  assert.match(source,/let localSourceInFlight=null/);
  assert.match(source,/if\(localSourceInFlight\|\|initialLocal\?\.sourceExhausted===true\|\|Number\(initialLocal\?\.queuedCount\|\|0\)>=LOCAL_SOURCE_TARGET_QUEUE\)return;/);
  assert.match(source,/startLocalSourceRefill\(local\);/);
  assert.doesNotMatch(source,/await startLocalSourceRefill\(local\)/);
  assert.match(source,/if\(batch\.deferred===true\)\{/);
  assert.match(source,/nextCursor:Math\.max\(cursor\+1,/);
  assert.match(source,/source_step_skipped_after_defer/);
  assert.match(source,/if\(Number\(local\.sourceCursor\|\|0\)===0\)nextLocalSourceAt=0/);
});
