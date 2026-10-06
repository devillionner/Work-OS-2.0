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
// 2026-10-04: the autonomous run's state moved from the Work OS tab into the owner Durable Object; the
// runner no longer polls the tab through CDP but gets run items pushed like every other process.
void test('the autonomous run is pushed over the live channel and serialized with every other task through one CDP lock',()=>{
  assert.doesNotMatch(source,/readWorkOsLocalDiscoveryTaskViaCdp|writeWorkOsLocalDiscoveryResultViaCdp|markWorkOsLocalDiscoveryCandidateViaCdp|applyWorkOsLocalDiscoverySourceBatchViaCdp|async function runOnce/);
  assert.match(source,/function withCdpLock\(fn\)/);
  assert.match(source,/await withCdpLock\(\(\)=>\{/);
  assert.match(source,/if\(next\.taskProcess==='discovery_run_task'\)return handleRunCandidateTask\(next\.task\);/);
  assert.match(source,/if\(next\.taskProcess==='discovery_run_source'\)return handleRunSourceStep\(next\.task\);/);
  assert.match(source,/message\.type==='run_task'&&message\.task\)\{\s*enqueueTask\(ws,'discovery_run_task',message\.task\);/);
  for(const type of ['progress','result','release','source_result','pause'])assert.match(source,new RegExp(`type:'${type}',process:'discovery_run'`));
  assert.match(source,/processLocalPreflight/);
  assert.match(source,/approval_required/);
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

void test('runner never source-crawls through D1 and no longer polls the Work OS tab',()=>{
  assert.match(source,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.doesNotMatch(source,/IDLE_POLL_MIN_MS|idleDelayMs|LOCAL_PREFLIGHT_POLL_MS|LOCAL_SOURCE_MIN_MS/);
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


void test('a locally cooled-down candidate goes back to the DO with its cooldown so other candidates continue',()=>{
  const handler=source.slice(source.indexOf('async function handleRunCandidateTask'),source.indexOf('function sendSourceResult'));
  assert.match(handler,/if\(Date\.now\(\)<whatsappRuntimeBlockedUntil\|\|taskIsLocallyBlocked\(task\)\)\{\s*releaseRunCandidate\(task,Math\.max\(whatsappRuntimeBlockedUntil,Number\(taskBlockedUntil\.get\(task\.candidateId\)\|\|0\),Date\.now\(\)\+1000\)\);/);
  // Every dispatched item is answered while the run is active, or the DO would wait for it forever.
  assert.match(handler,/if\(!runTaskAnswered&&localRunStillActive\(task\)\)releaseRunCandidate\(task,Date\.now\(\)\+15000\);/);
  assert.match(source,/PAGE_RECOVERY_COOLDOWN_MS=15000/);
});


void test('runner recovers a WhatsApp home stuck on message loading without stealing focus',()=>{
  assert.match(source,/health\.loading===true/);
  assert.match(source,/whatsappLoadingSignals\+=1/);
  assert.match(source,/WHATSAPP_LOADING_RELOAD_AFTER=3/);
  assert.match(source,/resetWhatsappPageViaCdp/);
  assert.match(source,/reloaded home and will resume after cooldown/);
});

// Since 2026-10-02 sources are public Telegram groups searched in the operator's Telegram Web tabs (no
// channels). WhatsApp Web still needs the foreground, so WhatsApp work and Telegram steps take turns
// instead of running a background source pump next to each other.
void test('a Telegram source step searches public groups from the plan the DO pushed with the run',()=>{
  assert.match(source,/telegramGroupDiscoveryPlan\(runPlan\.seedData,runPlan\.telegramGroups\|\|\[\]\)/);
  assert.match(source,/searchTelegramPublicGroups\(sessions\[0\],step\.query/);
  assert.match(source,/scanTelegramGroupForInvites\(session,group\)/);
  assert.doesNotMatch(source,/crawlLocalDiscoverySource|startLocalSourceRefill|localSourceInFlight/);
  // Turn-taking with WhatsApp checks now lives in the DO (one run item in flight, a queued candidate first).
  assert.match(source,/message\.type==='run_source'\)\{\s*enqueueTask\(ws,'discovery_run_source'/);
});

// Operator goal 2026-10-06: автопошук has to find chats every day. A search plan alone cannot do that — it
// only ever reaches groups a query surfaces — so every run opens the known invite sources first.
void test('a run starts by revisiting the groups that are known to post invites',()=>{
  const resolve=source.slice(source.indexOf('function resolveRunSourcePlan'),source.indexOf('const scannedGroupsFile'));
  assert.match(resolve,/const revisit=resolveRevisitGroups\(runId\)/);
  assert.match(resolve,/localSourcePlan=\[\.\.\.revisitSteps\(revisit\),\.\.\.telegramGroupDiscoveryPlan\(runPlan\.seedData,runPlan\.telegramGroups\|\|\[\]\)\]/);
  // The DO re-sends run_plan with the same runId after a runner restart while the run cursor keeps counting
  // steps, so the revisit list has to be frozen per run instead of recomputed from the clock.
  assert.match(source,/stored&&stored\.runId===runId&&Array\.isArray\(stored\.groups\)/);
  assert.match(source,/writeStateFile\(revisitPlanFile,\{runId,groups\}\)/);
  // A group counts as an invite source only by what the scan actually read; one that could not be opened
  // (gone, join request only) must not win a daily slot.
  assert.match(source,/noteGroupScanned\(group\.username,scan\.status==='scanned'\?scan\.invites\.length:0\)/);
  assert.match(source,/rememberScannedGroups\(readScannedGroups\(\),scans,Date\.now\(\)\)/);
});

void test('Telegram refusal stops the run on the same step and a scanned group waits out its own cooldown',()=>{
  const step=source.slice(source.indexOf('async function handleRunSourceStep'),source.indexOf('// --- Live channel (commit 3e)'));
  assert.match(step,/if\(crawled\.blockedReason\)\{/);
  assert.match(step,/sendLive\(liveWs,\{type:'pause',process:'discovery_run',runId:job\.runId,reason:crawled\.blockedReason,query:crawled\.query\}\)/);
  assert.match(step,/setStatus\('attention'/);
  assert.match(step,/if\(crawled\.interrupted\)return;\s*const batch=\{\s*nextCursor:cursor\+1,/);
  // Groups count as searched only after the DO applied their invites.
  assert.doesNotMatch(step,/markGroupsScanned/);
  assert.match(source,/message\.type==='run_source_applied'\)\{\s*markGroupsScanned\(/);
  // Since 2026-10-06 the cooldown is per group, not a flat week: scripts/telegram-group-memory.mjs decides.
  assert.match(source,/groupRecentlyScanned\(scanned,group\.username\)/);
  assert.match(source,/return !isGroupScanDue\(scanned,username,Date\.now\(\)\)/);
  assert.doesNotMatch(source,/TELEGRAM_GROUP_RESCAN_MS/);
  assert.match(source,/if\(!localRunStillActive\(local\)\)\{outcome\.interrupted=true;return;\}/);
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
const localPreflight=source.slice(source.indexOf('async function processLocalPreflight('),source.indexOf('function resolveRunSourcePlan'));

void test('a failing or slow local candidate is deferred alone with bounded retries and never freezes WhatsApp',()=>{
  const defer=source.slice(source.indexOf('async function deferLocalPreflight'),source.indexOf('const FRESH_JOIN_MANUAL_REVIEW_REASONS'));
  assert.match(defer,/if\(Number\(checkpoint\.attempts\)>=3\)\{/);
  assert.match(defer,/decision:'unavailable',reasonCodes:\['retry_exhausted',reason\]/);
  assert.match(defer,/markTaskBlocked\(task,reason,15000\);\s*releaseRunCandidate\(task,Date\.now\(\)\+15000\);/);
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
});

// Operator decision 2026-10-05: an invite that needs admin approval is no longer skipped on sight — it
// is screened against member-count/topic/community like any other candidate first (same order as
// above), and only once it passes does the join attempt run and actually send the request.
void test('an approval-gated invite that clears member-count/topic/community still gets a join request sent, and lands in review while it is pending — not skipped',async()=>{
  const reject=localPreflight.indexOf("return completeLocalPreflight(task,{decision:'rejected',reasonCodes:reasons");
  const approvalEarlyExit=localPreflight.indexOf("decision:'skipped',reasonCodes:['approval_required']");
  assert.equal(approvalEarlyExit,-1,'approval_required no longer short-circuits before the member-count/topic/community screen');
  assert.ok(reject>0);

  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  // The direct WhatsApp runtime API has no "request to join" call — approval_required from it now
  // falls back to the UI adapter (same fallback lane as direct_join_unavailable) instead of giving up.
  assert.match(localPreflight,/\['direct_join_unavailable','joined_identity_missing','approval_required'\]\.includes\(joined\.reason\)/);
  // The UI adapter sends the actual "Request to join" click for join_and_inspect too, not only
  // waiting_check — the button check now runs before the text-only approvalRequiredPattern fallback
  // (which still exists for the rare case where the text appears without any clickable button).
  const requestCheck=adapter.indexOf("if (requestButtonText) {");
  const textFallback=adapter.indexOf("task.action === 'join_and_inspect' && approvalRequiredPattern.test");
  assert.ok(requestCheck>0&&textFallback>requestCheck,'the request button is tried before the text-only fallback gives up');
  assert.match(adapter,/if \(requestButtonText\) \{\s*return \{ kind: 'action', action: 'request', buttonText: requestButtonText, observedName \};/);
  // Both outcomes of an approval-required check — a sent-but-not-yet-approved request
  // (membershipState 'pending') AND the text-only fallback that found no clickable button
  // (membershipState stays 'not_checked') — are review candidates the operator can see, not a dead
  // end, and not the generic 'incomplete' retry loop (approval can take days; a missing button may
  // just work on the next retry). qualifyLocalResult is defined before the localPreflight slice
  // starts, so check the full source.
  assert.match(source,/if\(result\.reason==='approval_required'\|\|result\.membershipState==='pending'\)\{\s*return qualifyApprovalRequired\(task,result\);/);
  assert.match(source,/function qualifyApprovalRequired\(task,result\)\{/);
  assert.match(source,/const asIfJoined=evaluateLocalPreflight\(task,\{\.\.\.result,membershipState:'joined'\}\);/);
  assert.match(source,/if\(asIfJoined\.decision==='rejected'\)\{\s*return completeLocalPreflight\(task,\{decision:'rejected',reasonCodes:asIfJoined\.reasonCodes,result,leftAfterCheck:false\}\);/);
  assert.match(source,/return completeLocalPreflight\(task,\{decision:'review',reasonCodes:\['approval_required'\]/);
});

void test('local Discovery joins through the WhatsApp runtime and uses the invite UI only as a bounded fallback',async()=>{
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  assert.match(adapter,/export async function joinWhatsappInviteViaRuntime/);
  assert.match(adapter,/WAWebGroupInviteJob/);
  assert.match(adapter,/export async function leaveWhatsappGroupViaRuntime/);
  // The UI adapter runs only on the last metadata attempt or when the runtime join module is unavailable.
  assert.match(localPreflight,/if\(Number\(task\.checkpoint\?\.attempts\)>=3\)\{[\s\S]*?inspectWhatsappTaskViaCdp\(task/);
  assert.match(localPreflight,/\['direct_join_unavailable','joined_identity_missing','approval_required'\]\.includes\(joined\.reason\)/);
  assert.match(localPreflight,/Do not perform a second join after a timeout if WhatsApp may have accepted it/);
});

void test('deferred candidates do not count as queued, so they cannot starve the Telegram source step',async()=>{
  const runState=await readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8');
  assert.match(runState,/candidate\.id !== state\.activeCandidateId && !\(Number\(candidate\.skipUntil\) > now\)/);
  assert.match(runState,/return state\.running && !state\.sourceExhausted && queuedCount\(state, now\) < SOURCE_TARGET_QUEUE;/);
});

// Live report 2026-10-04: after Stop the runner kept scrolling Telegram for up to a minute, and results
// appeared only when a whole 3-group step finished, so a paused step threw away what it had found.
void test('Stop interrupts a Telegram step mid-group, and each scanned group is reported to the DO right away', async () => {
  const telegram = await readFile(new URL('../scripts/telegram-web-cdp.mjs', import.meta.url), 'utf8');
  const sessionClass = telegram.slice(telegram.indexOf('export class TelegramWebSession'), telegram.indexOf('// Global Telegram search for one plan query'));
  assert.match(sessionClass, /async wait\(ms\) \{[\s\S]*?await sleep\(Math\.min\(250, end - Date\.now\(\)\)\);\s*this\.checkStop\(\);/);
  assert.match(sessionClass, /async pause\(\) \{ await this\.wait\(/);
  // Only wait() itself sleeps; every other wait inside a step goes through it and its stop check.
  assert.equal((sessionClass.match(/await sleep\(/g) || []).length, 1, 'no wait inside a step bypasses the stop check');
  assert.match(source, /openTelegramWebSessions\(\{cdpBaseUrl:whatsappCdp,maxTabs:TELEGRAM_PARALLEL_TABS,shouldStop:\(\)=>aborted\|\|!localRunStillActive\(local\)\}\)/);
  assert.match(source, /if\(error\?\.name==='TelegramStopped'\)\{outcome\.interrupted=true;/);
  assert.match(source, /type:'source_result',process:'discovery_run',runId:job\.runId,partial:true,/);
});

// Operator decision 2026-10-06: four Telegram Web tabs of the same account scan one step together.
void test('a Telegram step fans its groups out over the tab pool without losing or double-scanning one', () => {
  const step = source.slice(source.indexOf('async function crawlTelegramGroupStep'), source.indexOf('const TELEGRAM_BLOCK_LABELS={'));
  // One shared cursor: a tab takes the next group, so no group is scanned twice and none is skipped.
  assert.match(step, /let nextGroup=0;/);
  assert.match(step, /if\(nextGroup>=groups\.length\)return;\s*const group=groups\[nextGroup\+\+\];/);
  // allSettled, not all: one failing tab must not discard what the others already scanned.
  assert.match(step, /await Promise\.allSettled\(workers\.map\(scanWithSession\)\)/);
  assert.match(step, /const workers=sessions\.slice\(0,Math\.max\(1,Math\.min\(sessions\.length,groups\.length\)\)\)/);
  // A flood belongs to the account, so it brakes every tab — and is never reported as an operator Stop.
  assert.match(step, /if\(!outcome\.blockedReason\)outcome\.blockedReason=scan\.reason;\s*aborted=true;/);
  assert.match(step, /if\(!outcome\.blockedReason\)\{outcome\.interrupted=true;/);
  // Every leased tab is closed, not just the first one.
  assert.match(step, /for\(const session of sessions\)session\.close\(\);/);
});

void test('a Telegram session wait ends within a fraction of a second after Stop', async () => {
  const { TelegramWebSession, TelegramStopped } = await import('../scripts/telegram-web-cdp.mjs');
  let stopped = false;
  const session = new TelegramWebSession({ close() {} }, () => 5_000, () => stopped);
  setTimeout(() => { stopped = true; }, 200);
  const startedAt = Date.now();
  await assert.rejects(session.pause(), (error) => error instanceof TelegramStopped);
  assert.ok(Date.now() - startedAt < 800, `stopped after ${Date.now() - startedAt} ms, not after the full 5 s pause`);
});
