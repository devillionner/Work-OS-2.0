import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');

void test('runner authenticates its live WebSocket with the executor token as a query parameter',()=>{
  assert.match(source,/WORK_OS_EXECUTOR_TOKEN/);
  assert.match(source,/url\.searchParams\.set\('token',token\)/);
  assert.match(source,/url\.searchParams\.set\('kind','runner'\)/);
  assert.doesNotMatch(source,/Authorization:/);
  assert.match(source,/type:'result',process:'discovery'/);
  assert.match(source,/type:'release',process:taskProcess/);
  assert.match(source,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
});
void test('runner services live-channel pending checks while local Discovery remains active, serialized through one CDP lock',()=>{
  assert.match(source,/readWorkOsLocalDiscoveryTaskViaCdp/);
  assert.match(source,/writeWorkOsLocalDiscoveryResultViaCdp/);
  assert.match(source,/processLocalPreflight/);
  assert.match(source,/approval_required/);
  assert.match(source,/function withCdpLock\(fn\)/);
  assert.match(source,/outcome=await withCdpLock\(runOnce\)/);
  assert.match(source,/await withCdpLock\(\(\)=>\{/);
  const pump=source.indexOf('async function pumpTaskQueue');
  const local=source.indexOf('readWorkOsLocalDiscoveryTaskViaCdp',source.indexOf('async function runOnce'));
  assert.ok(pump>0&&local>pump);
});

void test('runner automates verified WhatsApp leave via CDP and retains operator-confirmed fallback',()=>{
  assert.match(source,/leaveWhatsappTaskViaCdp/);
  assert.match(source,/Verified WhatsApp leave accepted by Work OS/);
  assert.match(source,/leave automation stopped fail-closed/);
  assert.match(source,/if\(!process\.stdin\.isTTY\)\{releaseTask\(ws,'discovery',task/);
});

void test('runner requires operator confirmation before reporting external leave',()=>{
  const prompt=source.indexOf('Confirm only AFTER you actually left the chat');
  const callback=source.lastIndexOf("type:'result',process:'discovery',candidateId:task.candidateId,chatStateToken");
  assert.ok(prompt>0&&callback>prompt);
  assert.match(source,/xdg-open/);
});

void test('runner verifies the exact messenger target before inspection or leave callbacks',()=>{
  const targetPrompt=source.indexOf('Exact target verified as');
  const inspectCallback=source.indexOf("type:'result',process:'discovery',candidateId:task.candidateId,result:inspection.result");
  const leaveCallback=source.indexOf("type:'result',process:'discovery',candidateId:task.candidateId,chatStateToken");
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


void test('autopost tasks push a confirmed-send result back over the live channel, independent of the other two processes',()=>{
  assert.match(source,/sendWhatsappAutopostViaCdp/);
  assert.match(source,/type:'result',process:'autopost',jobId:job\.jobId,status:'sent'/);
  assert.match(source,/sendConfirmed:true/);
  assert.match(source,/WhatsApp autopost stopped fail-closed/);
  assert.match(source,/Confirmed WhatsApp autopost accepted by Work OS/);
  // Commit 3e: each process gets pushed its own task independently by the owner Durable Object — the
  // runner no longer alternates between them itself (that round-robin existed only to share one HTTP
  // poll fairly in the pull model).
  assert.doesNotMatch(source,/preferAutopost/);
});

void test('runner never source-crawls through D1 and keeps bounded idle local-preflight polling',()=>{
  assert.match(source,/const IDLE_POLL_MIN_MS=2000/);
  assert.match(source,/const IDLE_POLL_MAX_MS=5000/);
  assert.match(source,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.match(source,/Math\.min\(IDLE_POLL_MAX_MS,idleDelayMs\*2\)/);
  assert.match(source,/Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP/);
  assert.match(source,/WHATSAPP_RUNTIME_COOLDOWN_MS=300000/);
  assert.match(source,/releasing until the browser adapter is available/);
});


void test('non-interactive runner fails before opening the live channel without a WhatsApp runtime, and transient CDP state pauses automated messenger work',()=>{
  const startupGuard=source.indexOf('Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP');
  const firstConnect=source.indexOf('function connectLiveChannel');
  assert.ok(startupGuard>0&&firstConnect>startupGuard);
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


void test('runner releases a locally blocked Discovery candidate back to the DO instead of retrying it in a tight loop',()=>{
  assert.match(source,/const TASK_BLOCK_COOLDOWN_MS=300000/);
  assert.match(source,/const taskBlockedUntil=new Map/);
  assert.match(source,/if\(taskIsLocallyBlocked\(task\)\)\{/);
  assert.match(source,/releaseTask\(ws,'discovery',task,Number\(taskBlockedUntil\.get\(task\.candidateId\)\|\|0\)\)/);
  assert.match(source,/markTaskBlocked\(task,inspection\.reason\)/);
  assert.match(source,/another candidate may continue/);
  // scheduleReady must wait out that candidate's own cooldown, or the DO (which always pushes the
  // same single next-eligible candidate) would just hand the same blocked item straight back.
  assert.match(source,/candidateUntilMs-Date\.now\(\)/);
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
  // A rejected WS handshake (commit 3e: no more 401-checking api() helper) is the new revocation
  // signal — same re-read, same exemption for a fixed env/clipboard token.
  assert.match(source,/if\(process\.argv\.includes\('--token-from-work-os-page'\)\)\{token='';nextTokenResolveAt=0;\}/);
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

// Since 2026-10-02 sources are public Telegram groups searched in the operator's Telegram Web tab (no
// channels). Telegram Web and WhatsApp Web both need the foreground, so the two take turns instead of
// running a background source pump next to WhatsApp work.
void test('local source step searches Telegram groups and alternates with WhatsApp checks',()=>{
  assert.match(source,/telegramGroupDiscoveryPlan\(localSourceSeedData,result\.telegramGroups\|\|\[\]\)/);
  assert.match(source,/searchTelegramPublicGroups\(session,step\.query/);
  assert.match(source,/scanTelegramGroupForInvites\(session,group\)/);
  assert.doesNotMatch(source,/crawlLocalDiscoverySource|startLocalSourceRefill|localSourceInFlight/);
  const runOnce=source.slice(source.indexOf('async function runOnce'),source.indexOf("console.log('Work OS Discovery runner started."));
  assert.ok(runOnce.indexOf('return processLocalPreflightVisible(local.task)')<runOnce.indexOf('return refillLocalSourceOnce(local)'));
});

void test('Telegram refusal stops the run on the same step and already searched groups are skipped for a week',()=>{
  const refill=source.slice(source.indexOf('async function refillLocalSourceOnce'),source.indexOf('let liveWs=null'));
  assert.match(refill,/if\(crawled\.blockedReason\)\{/);
  assert.match(refill,/pauseWorkOsLocalDiscoveryRunViaCdp\(baseUrl/);
  assert.match(refill,/setStatus\('attention'/);
  assert.match(refill,/nextCursor:crawled\.interrupted\?cursor:cursor\+1/);
  // Groups count as searched only after their invites reached the Work OS session.
  assert.ok(refill.lastIndexOf('markGroupsScanned(crawled.scannedGroups)')>refill.lastIndexOf('applyWorkOsLocalDiscoverySourceBatchViaCdp'));
  assert.match(source,/const TELEGRAM_GROUP_RESCAN_MS=7\*24\*60\*60\*1000/);
  assert.match(source,/if\(!await localRunStillActive\(local\)\)\{outcome\.interrupted=true;break;\}/);
});

void test('source refill has only a short idle gap',()=>{
  assert.match(source,/LOCAL_SOURCE_MIN_MS=500/);
});

void test('waiting checks are pushed one chat at a time over the live channel and runtime problems release the chat',()=>{
  const start=source.indexOf('async function handleWaitingCheckTask');
  const block=source.slice(start,source.indexOf('async function handleAutopostTask',start));
  assert.match(block,/checkWhatsappWaitingInviteViaCdp\(task/);
  assert.match(block,/releaseTask\(ws,'waiting_check',task\)/);
  assert.match(block,/type:'result',process:'waiting_check'/);
  assert.doesNotMatch(source,/pause-waiting-check/);
});

void test('commit 3e: the live channel replaces D1 polling entirely — no cloud cadence, no idle backoff, no per-process alternation',()=>{
  assert.doesNotMatch(source,/runD1BackedTaskOnce|CLOUD_AUTOMATION_POLL_MS|CLOUD_AUTOMATION_IDLE_MAX_MS|cloudAutomationDelayMs|nextCloudAutomationAt/);
  assert.match(source,/function connectLiveChannel\(\)/);
  assert.match(source,/const WS_RECONNECT_MIN_MS=1000/);
  assert.match(source,/const WS_RECONNECT_MAX_MS=30000/);
  assert.match(source,/wsReconnectDelayMs=Math\.min\(WS_RECONNECT_MAX_MS,wsReconnectDelayMs\*2\)/);
});

void test('runner never gates the live channel on whether Work OS is in use — an idle connection costs nothing, unlike the old D1 poll',()=>{
  assert.doesNotMatch(source,/cloudDemand|USER_ACTIVE_WINDOW_MS|WORK_GRACE_MS|DEMAND_CHECK_MS|readWorkOsLastActivityViaCdp/);
  assert.doesNotMatch(source,/setStatus\('paused'/);
  // The live channel connects unconditionally once a token exists; only token availability gates it.
  const connect=source.slice(source.indexOf('function connectLiveChannel'),source.indexOf('function scheduleReconnect'));
  assert.match(connect,/if\(!token\)\{setTimeout\(connectLiveChannel,2000\);return;\}/);
});

void test('a rejected handshake and a later drop both trigger reconnect, not just one of the two WebSocket events',()=>{
  const connect=source.slice(source.indexOf('function connectLiveChannel'),source.indexOf('function scheduleReconnect'));
  assert.match(connect,/ws\.addEventListener\('close',onDown\)/);
  assert.match(connect,/ws\.addEventListener\('error',onDown\)/);
  assert.match(connect,/let settled=false/);
  assert.match(connect,/if\(settled\)return;\s*settled=true;/);
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
const localPreflight=source.slice(source.indexOf('async function processLocalPreflight('),source.indexOf('async function resolveLocalSourcePlan'));

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

void test('deferred candidates do not count as queued, so they cannot starve the Telegram source step',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(adapter,/queuedCount:candidates\.filter\(item=>item\?\.preflightState==='queued'&&!results\[item\?\.id\]&&!skipped\.has\(item\?\.id\)\)\.length/);
  assert.match(source,/Number\(local\.queuedCount\|\|0\)>=LOCAL_SOURCE_TARGET_QUEUE\)return 'local_wait'/);
});
