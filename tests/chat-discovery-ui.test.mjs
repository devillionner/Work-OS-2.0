import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Platforms exposes an explicit autonomous outcome loop plus a local manual fallback', async () => {
  const [workspace, dialog, previewRoute, previewDomain, runRoute] = await Promise.all([
    readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/preview/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/run/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /ChatDiscoveryDialog/);
  assert.match(workspace, /Знайти чати/);
  assert.match(dialog, /Запустити автопошук/);
  // Since 2026-10-04 the run lives in the owner Durable Object: the dialog starts/pauses it over HTTP and
  // shows it, the tab's sessionStorage holds nothing.
  assert.match(dialog, /await postRun\(\{action:'start',goal\}\)/);
  assert.doesNotMatch(dialog, /sessionStorage|work-os:chat-discovery-local-preview/);
  assert.match(runRoute, /const ACTIONS = new Set\(\['start', 'resume', 'pause', 'confirmed', 'archived', 'non-target', 'retry'\]\)/);
  assert.match(dialog, /localTargets\.length/);
  assert.match(dialog, /'Підтвердити'/);
  assert.match(dialog, /Архівувати всі/);
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /Відхилити/);
  assert.match(previewRoute, /body\.action==='confirm'/);
  assert.match(previewDomain, /confirmLocalDiscoveryPreview/);
});

void test('local autonomous preflight exposes only factual targets before D1 confirmation', async () => {
  const [dialog, runner, preview, runState] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog,/preflightState==='target'/);
  assert.match(dialog,/emptyCandidateCopy/);
  assert.match(runState,/export function applyResult\(state: DiscoveryRunState, candidateId: string, payload: RunResultPayload, now: number\)/);
  assert.match(runner,/type:'result',process:'discovery_run',candidateId:task\.candidateId,payload:final/);
  assert.match(runner,/approval_required/);
  assert.match(preview,/До D1 можна підтвердити лише фактично перевірений цільовий чат/);
});

void test('browser-local source crawl uses targeted D1 dedupe and no owner-wide 10k scan', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  // One bounded source query per Worker call.
  assert.match(preview, /const batchSize=1;/);
  assert.match(preview, /buildTelegramSearchPlan\(telegramCursor,batchSize\)/);
  assert.match(preview, /maxQueries:batchSize,pageLimit:1/);
  // Each invite is one unique-index lookup; `normalized_link IN (json_each)` without the platform walked every
  // chat and candidate of the owner per source (measured in tests/d1-poll-budget.test.mjs).
  assert.match(preview, /FROM json_each\(\?2\) j CROSS JOIN chats c\s+WHERE c\.user_id=\?1 AND c\.platform=\?3 AND c\.normalized_link=j\.value/);
  assert.match(preview, /FROM json_each\(\?2\) j CROSS JOIN chat_discovery_candidates d\s+WHERE d\.user_id=\?1 AND d\.platform=\?3 AND d\.normalized_link=j\.value/);
  assert.doesNotMatch(preview, /normalized_link IN \(SELECT value FROM json_each/);
  assert.doesNotMatch(preview, /LIMIT 10001/);
  const searchStart=preview.indexOf('export async function searchLocalDiscoveryPreview');
  const searchBody=preview.slice(searchStart,preview.indexOf('export async function',searchStart+1));
  assert.doesNotMatch(searchBody,/INSERT INTO chat_discovery_candidates/);
  assert.doesNotMatch(searchBody,/UPDATE chat_discovery_runs/);
});

void test('final local automation outcomes are the persistence boundary', async () => {
  const [dialog, preview] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /action:'confirm'/);
  assert.match(dialog, /Відхилити/);
  assert.match(preview, /INSERT INTO chat_discovery_candidates/);
  assert.match(preview, /handoffDiscoveryCandidate/);
});

void test('Discovery executor cannot source-crawl raw candidates before factual local qualification', async () => {
  const [runner, executor] = await Promise.all([
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(runner,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.match(executor,/sourceAdvanceNeeded: false/);
  assert.doesNotMatch(executor,/SELECT min_members,status FROM chat_discovery_runs/);
});

// Operator decision 2026-10-02: outcomes stay in the tab session; non-targets become durable dedupe only
// through «Архівувати всі» (one batch), targets only through «Підтвердити».
void test('local WhatsApp outcomes become durable dedupe only through archive-all, targets only through confirm', async()=>{
  const [previewRoute,previewDomain,adapter,dialog,domain]=await Promise.all([
    readFile(new URL('../app/api/chat-discovery/preview/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts',import.meta.url),'utf8'),
    readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts',import.meta.url),'utf8'),
  ]);
  assert.match(previewRoute,/body\.action==='archive-outcomes'/);
  assert.match(previewDomain,/export async function archiveLocalDiscoveryOutcomes/);
  assert.match(previewDomain,/await db\.batch\(statements\);\n  return \{archived:seen\.size\};/);
  assert.match(previewDomain,/Архівувати можна лише нецільові чати/);
  assert.doesNotMatch(adapter,/persist-outcome/);
  assert.match(dialog,/action:'archive-outcomes',items:chunk\.map\(archiveItem\)/);
  assert.match(dialog,/Дані пошуку/);
  const reset=domain.slice(domain.indexOf('export async function resetDiscoveryWorkspace'),domain.indexOf('export async function continueDiscoveryRun'));
  assert.match(reset,/preservedCandidates/);
  assert.doesNotMatch(reset,/DELETE FROM chat_discovery_candidates/);
});

void test('saved target is an explicit operator decision point', async()=>{
  const [dialog,runState]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8'),
  ]);
  assert.match(dialog,/archiveCandidate\(candidate/);
  assert.match(dialog,/action:'archive-candidate'/);
  assert.match(dialog,/await postRun\(\{action:'non-target',candidateId:candidate\.id\}\)/);
  assert.match(runState,/operator_rejected/);
  assert.match(dialog,/Лишити в роботі/);
  assert.match(dialog,/В архів/);
  assert.match(dialog,/savedJoinedTarget/);
  assert.match(dialog,/useFactualConfirm/);
});

void test('manual Telegram recovery stays out of the operator modal', async () => {
  const [dialog, previewRoute] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/preview/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(dialog, /Додаткове джерело Telegram/);
  assert.doesNotMatch(dialog, /Додати локально й очистити/);
  assert.doesNotMatch(dialog, /action:'telegram'/);
  assert.match(previewRoute,/previewTelegramDiscoveryText/);
});

void test('discovery UI goal remains WhatsApp-first and requires no manual keyword inputs', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Цільових чатів/);
  assert.match(dialog, /useState\(50\)/);
  assert.match(dialog, /const minMembers = 700/);
  assert.match(dialog, /const platforms: DiscoveryPlatform\[\] = \['whatsapp'\]/);
  assert.doesNotMatch(dialog, /id="discovery-min-members"/);
});

void test('persisted Discovery keeps membership, qualification and cleanup lifecycle', async () => {
  const [dialog, route, executor] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Очікує схвалення/);
  assert.match(dialog, /Приєднано/);
  assert.match(dialog, /Кваліфікувати вручну/);
  assert.match(dialog, /Work OS виходить із нього та архівує/);
  assert.match(route, /body\.action === 'inspect'/);
  // Pending WhatsApp memberships are rechecked by the operator Waiting batch, not by Discovery leases.
  assert.doesNotMatch(executor, /membership_state='pending' AND checked_at<0/);
  const waiting = await readFile(new URL('../lib/chats/whatsapp-waiting-check.ts', import.meta.url), 'utf8');
  assert.match(waiting, /c\.platform='whatsapp' AND c\.workflow_status='waiting'/);
});

void test('Chat Discovery modal uses a wide split layout with independent candidate scrolling', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /!max-w-\[1240px\]/);
  assert.match(dialog, /h-\[min\(92dvh,920px\)\]/);
  assert.match(dialog, /lg:grid-cols-\[330px_minmax\(0,1fr\)\]/);
  assert.match(dialog, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(dialog, /Фільтр кандидатів/);
  assert.match(dialog, /Автопошук WhatsApp-чатів/);
  assert.match(dialog, /\['active', 'В роботі'/);
  assert.match(dialog, /\['target', 'Цільові'/);
  assert.match(dialog, /\['rejected', 'Нецільові'/);
  assert.doesNotMatch(dialog, /StatTile/);
});

void test('candidate cards lead with human-readable automation status and keep criteria collapsed', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidateStatus\(candidate\)/);
  assert.match(dialog, /<details className="mt-3[^"]*">\s*<summary[^>]*>\s*Деталі перевірки · \{confirmedCriteria\} із \{criteria\.length\}/);
  assert.match(dialog, /grid-cols-2 gap-2 md:grid-cols-3/);
  assert.match(dialog, /Додати на ручну перевірку/);
  assert.match(dialog, /Лишити в роботі/);
  assert.doesNotMatch(dialog, />Ручні дії</);
  assert.match(dialog, /candidateDisplayName/);
});

void test('candidate cards expose the WhatsApp link and every target qualification criterion', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Відкрити \{platformLabel\(candidate\.platform\)\}/);
  assert.match(dialog, /label: 'Учасники'/);
  assert.match(dialog, /label: 'Можна писати'/);
  assert.match(dialog, /label: 'Аудиторія'/);
  // Ad rules and activity are not target criteria (operator decision 2026-10-02); communities are not targets.
  assert.doesNotMatch(dialog, /label: 'Активність'/);
  assert.doesNotMatch(dialog, /label: 'Оголошення'/);
  assert.match(dialog, /const chatTypeOk = candidate\.chatType === 'group';/);
  assert.match(dialog, /chatTypeLabel/);
  assert.match(dialog, /adsPolicyLabel/);
  assert.match(dialog, /topicMatchLabel/);
});

void test('autonomous discovery launch is WhatsApp-only while domain keeps Viber recovery support', async () => {
  const [dialog, domain, executor] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /const platforms: DiscoveryPlatform\[\] = \['whatsapp'\]/);
  assert.match(dialog, /candidate\.platform === 'viber' \? 'invalid_viber_link' : 'invalid_whatsapp_link'/);
  assert.match(domain, /item === 'whatsapp' \|\| item === 'viber'/);
  assert.match(executor, /\['whatsapp','viber'\]\.includes\(chat\.platform\)/);
});

void test('operators can reject an invalid WhatsApp invite before creating a chat', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Invite недійсний/);
  assert.match(dialog, /invalid_whatsapp_link/);
  assert.match(dialog, /кандидат відхилено без створення чату/);
});

void test('left discovery chats require restore and rejoin before manual qualification', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidate\.membershipState !== 'left'/);
  assert.match(dialog, /Чат уже покинуто/);
  assert.match(dialog, /Для нової кваліфікації спочатку віднови його та підтвердь повторний вступ/);
});

void test('imported WhatsApp candidates have a manual qualification fallback using the inspection contract', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Кваліфікувати вручну/);
  assert.match(dialog, /Зберегти кваліфікацію/);
  assert.match(dialog, /Писати можуть учасники/);
  assert.match(dialog, /Дозволені/);
  assert.match(dialog, /Цільова/);
  assert.match(dialog, /membershipState: manualDraft\.membershipState/);
  assert.match(dialog, /topicMatch: manualDraft\.topicMatch/);
  assert.match(dialog, /action: 'inspect'/);
});

void test('executor panel explains browser/native runtime and fail-closed target safety', async () => {
  const panel = await readFile(new URL('../components/chat-discovery-executor-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /WhatsApp Web/);
  assert.match(panel, /runner до авторизованого WhatsApp Web/);
  assert.match(panel, /Непідтверджений target зупиняє дію/);
});


void test('source name hints fail closed when they contain markup or URL noise', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /safeDiscoveryNameHint/);
  assert.match(preview, /src\|href\|class\|id/);
  assert.match(preview, /suggestedChatName/);
});

void test('operator-first Discovery UI shows useful local throughput and keeps technical details secondary', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /із \{displayedGoal\} цільових чатів/);
  assert.match(dialog, />В роботі <strong/);
  assert.match(dialog, />Цільові <strong/);
  assert.match(dialog, />Нецільові <strong/);
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /Підключення WhatsApp/);
  assert.doesNotMatch(dialog, /<StatTile/);
});

void test('Discovery shows a simple activity time without a ticking countdown', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /formatActivityTime\(localPreview\.lastActivityAt\)/);
  assert.match(dialog, /hour:'2-digit',minute:'2-digit'/);
  assert.match(dialog, /flex items-center justify-between gap-3/);
  assert.match(dialog, />WhatsApp <strong/);
  assert.match(dialog, />Активність <strong/);
  assert.doesNotMatch(dialog, /Пошукових кроків/);
  assert.doesNotMatch(dialog, /lastRunActivitySeconds|setInterval\(\(\)=>setClockMs/);
  assert.doesNotMatch(dialog, /workspace\.run\?\.status!=='running'/);
});


// The persisted Work OS history is a separate, lazily loaded tab: opening the dialog reads no D1.
void test('Discovery keeps the local lists separate from the persisted history, which loads only on demand', async () => {
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/const displayCandidates:DiscoveryCandidate\[\]=filter==='history'\?workspace\.candidates:visibleLocal;/);
  assert.match(dialog,/if \(!open \|\| filter !== 'history'\) return;/);
  assert.match(dialog,/План пошуку завершено: знайдено \{displayedTargetCount\}/);
});

void test('Preview API transient HTML/5xx does not stop local autonomous search', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog,/const attempts=body\.action==='search'\?3:1/);
  assert.match(dialog,/Preview API повернув не-JSON відповідь/);
  assert.match(dialog,/response\.status>=500/);
  assert.match(dialog,/await new Promise\(resolve=>window\.setTimeout\(resolve,750\*attempt\)\)/);
  assert.match(dialog,/throw new Error\(lastError\)/);
});

void test('the Discovery run continues when the modal or the tab is closed and every device sees it', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  // The dialog only reads the run (DO storage, no D1) when it is open and on every pushed change.
  assert.match(dialog, /fetch\('\/api\/chat-discovery\/run',\{cache:'no-store'\}\)/);
  assert.match(dialog, /message\.type!=='process_state'\|\|message\.process!=='discovery_run'/);
  assert.match(dialog, /if\(!open\|\|liveConnected\|\|!localPreview\.running\)return;/);
  assert.match(dialog, /Можна закрити модалку чи вкладку й запустити з телефона/);
});


void test('browser-local Discovery source requests stay below the Worker CPU-risk envelope', async () => {
  const [preview, publicWeb] = await Promise.all([
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/public-web.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(preview,/maxQueries:batchSize,pageLimit:1/);
  assert.match(preview,/includeCurated:false/);
  assert.doesNotMatch(preview,/includeCurated:true/);
  assert.match(publicWeb,/MAX_PAGE_BYTES = 450_000/);
  assert.match(publicWeb,/if\(!hasRequestedInvite\)return \[\]/);
});


void test('source pacing lives in the owner DO dispatch instead of a fast modal polling loop', async () => {
  const [dialog,channel]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url),'utf8'),
    readFile(new URL('../workers/owner-channel.js', import.meta.url),'utf8'),
  ]);
  assert.match(channel,/if \(needsSourceStep\(run, now\)\) \{/);
  assert.match(dialog,/const RUN_FALLBACK_POLL_MS=15_000;/);
  assert.doesNotMatch(dialog,/\},350\);|\},750\);/);
});


void test('each autonomous source request is a single bounded task and public search is interleaved every third batch', async () => {
  const preview=await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url),'utf8');
  assert.match(preview,/const batchSize=1/);
  assert.match(preview,/completedBatches%3===2/);
});

void test('autonomous start reaches the runner through the owner DO, not the tab', async()=>{
  const channel=await readFile(new URL('../workers/owner-channel.js',import.meta.url),'utf8');
  const http=channel.slice(channel.indexOf('async handleDiscoveryRunHttp'),channel.indexOf('In-flight autopost/Discovery tasks owned by'));
  assert.match(http,/next = startRun\(run, \{ runId: crypto\.randomUUID\(\), goal: body\.goal, now \}\)/);
  assert.match(http,/this\.broadcast\('runner', await this\.runPlanMessage\(next\.runId\)\)/);
  assert.match(http,/this\.broadcast\('runner', \{ type: 'run_control', process: 'discovery_run', runId: next\.runId, active: true \}\)/);
});

void test('the WhatsApp check in progress is shown from the run state the runner reports', async()=>{
  const [dialog,runState]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8'),
  ]);
  assert.match(runState,/activeCandidateName: input\.name \|\| candidate\.name/);
  assert.match(runState,/lastCheckedName: candidate\.name \|\| 'WhatsApp chat'/);
  assert.match(dialog,/Перевіряємо WhatsApp:/);
});

void test('pausing autonomous discovery preserves unfinished candidates and momentum', async()=>{
  const [dialog,runState]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8'),
  ]);
  const stop=dialog.slice(dialog.indexOf('async function stopAutonomousSearch'),dialog.indexOf('async function retryIncompleteCandidate'));
  assert.match(stop,/await postRun\(\{action:'pause'\}\)/);
  assert.doesNotMatch(stop,/persist-outcome|paused_unverified/);
  const pause=runState.slice(runState.indexOf('export function pauseRun'),runState.indexOf('export function pauseOnSourceBlock'));
  assert.match(pause,/running: false/);
  assert.match(pause,/unverified: count\('queued'\)/);
  assert.match(pause,/cursor: state\.telegramCursor/);
  assert.match(dialog,/Пошук на паузі/);
  assert.match(dialog,/Прогрес збережено/);
});

void test('resuming a paused discovery run keeps cursor candidates and durable dedupe history', async()=>{
  const [dialog,runState]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8'),
  ]);
  const start=dialog.slice(dialog.indexOf('async function startAutonomousSearch'),dialog.indexOf('async function stopAutonomousSearch'));
  assert.match(start,/if\(canResume\(localPreview\)\)\{\s*const resumed=await postRun\(\{action:'resume'\}\);/);
  assert.match(start,/Уже перевірені запрошення й переглянуті Telegram-групи не повторюються/);
  // A new run keeps unconfirmed results, so nothing already checked is checked again.
  assert.match(runState,/candidates: previous\.candidates\.filter\(\(candidate\) => FINISHED_STATES\.has\(String\(candidate\.preflightState\)\)\)/);
  const resume=runState.slice(runState.indexOf('export function resumeRun'),runState.indexOf('export function canResume'));
  assert.match(resume,/\.\.\.state,/);
  assert.match(resume,/pauseSummary: null/);
  assert.match(dialog,/Продовжити автопошук/);
});

void test('pause transition stays visually coherent while archive persistence runs',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/const \[pausing,setPausing\]=useState\(false\)/);
  assert.match(dialog,/setPausing\(true\)/);
  assert.match(dialog,/Зберігаємо паузу…/);
  assert.match(dialog,/Зупиняємо пошук · зберігаємо прогрес/);
  assert.match(dialog,/setPausing\(false\)/);
});


void test('fresh joins without pre-join history have a dedicated non-blocking manual-review lane',async()=>{
  const [dialog,preview,runner]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts',import.meta.url),'utf8'),
    readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8'),
  ]);
  assert.match(dialog,/Потрібне твоє рішення/);
  assert.match(dialog,/preflightState==='review'/);
  assert.match(dialog,/З групи автоматично не виходимо/);
  assert.match(preview,/ARCHIVABLE_DECISIONS=new Set\(\['rejected','skipped','unavailable'\]\)/);
  assert.match(runner,/fresh_join_history_unavailable/);
  assert.doesNotMatch(runner,/POST_JOIN_EVIDENCE_RECHECK_MS/);
});

void test('Discovery exposes primary review actions directly and uses contextual empty states',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/Додати на ручну перевірку/);
  assert.match(dialog,/Відхилити/);
  assert.match(dialog,/Нецільових немає/);
  assert.match(dialog,/Цільових чатів поки немає/);
  assert.doesNotMatch(dialog,/xl:grid-cols-6/);
  assert.match(dialog,/Історія Work OS/);
  assert.match(dialog,/!w-\[calc\(100dvw-20px\)\]/);
  assert.match(dialog,/sm:!w-\[calc\(100dvw-32px\)\]/);
  assert.match(dialog,/min-h-11/);
});

void test('Discovery UI explains browser progress versus durable Work OS decisions without backend jargon',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/Шукає WhatsApp-запрошення в публічних Telegram-групах/);
  assert.match(dialog,/У Work OS нічого не записується, доки ти не натиснеш «Підтвердити» або «Архівувати всі»/);
  assert.match(dialog,/Дані пошуку/);
  assert.match(dialog,/Підключення WhatsApp/);
  assert.doesNotMatch(dialog,/Persistent dedupe/);
  assert.doesNotMatch(dialog,/Сирі invite в D1/);
});


void test('stale source cooldown warnings disappear after pause and resume', async()=>{
  const [dialog,runState]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8'),
  ]);
  // Shown while running (temporary source problems) and after a Telegram stop (what to fix before resuming).
  assert.match(dialog,/\{localPreview\.sourceIssues\.length>0&&<details/);
  assert.match(runState.slice(runState.indexOf('export function pauseRun'),runState.indexOf('export function pauseOnSourceBlock')),/sourceFailures: 0, sourceIssues: \[\]/);
  assert.match(runState.slice(runState.indexOf('export function resumeRun'),runState.indexOf('export function canResume')),/sourceFailures: 0, sourceIssues: \[\]/);
});


void test('Discovery candidate cards use one clear details disclosure and an explicit review action',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/Деталі перевірки · \{confirmedCriteria\} із \{criteria\.length\}/);
  assert.doesNotMatch(dialog,/Що треба уточнити/);
  assert.match(dialog,/У нецільові/);
  assert.match(dialog,/у Work OS — після «Архівувати всі»/);
  assert.doesNotMatch(dialog,/Чому тут/);
  assert.doesNotMatch(dialog,/Посилання та джерела/);
  assert.doesNotMatch(dialog,/Продовжити вручну/);
});


void test('Discovery qualification has one visible source of truth',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const details=dialog.slice(dialog.indexOf('Деталі перевірки ·'),dialog.indexOf('<div className="mt-3 flex flex-wrap items-center gap-2'));
  assert.match(details,/criteria\.map\(item => <Criterion/);
  assert.doesNotMatch(details,/candidate\.reasonCodes\.map/);
  assert.doesNotMatch(details,/Що треба уточнити/);
});


void test('final WhatsApp facts never inherit optimistic source guesses', async()=>{
  const runState=await readFile(new URL('../lib/chat-discovery/run-state.ts',import.meta.url),'utf8');
  assert.match(runState,/topicMatch: result\.topicMatch === 'match' \|\| result\.topicMatch === 'mismatch' \? result\.topicMatch : 'unknown'/);
  assert.match(runState,/canWrite: typeof result\.canWrite === 'boolean' \? result\.canWrite : null/);
  assert.match(runState,/activityState: result\.activityState === 'active' \|\| result\.activityState === 'dead' \? result\.activityState : 'unknown'/);
  assert.doesNotMatch(runState,/result\.topicMatch === 'mismatch' \? result\.topicMatch : candidate\.topicMatch/);
});


void test('WhatsApp waiting-check UI handles empty or non-JSON server failures without exposing Response.json parser errors', async()=>{
  const workspace=await readFile(new URL('../components/platform-workspace.tsx',import.meta.url),'utf8');
  assert.match(workspace,/async function readWaitingCheckResponse\(response:Response\)/);
  assert.match(workspace,/const raw=await response\.text\(\)/);
  assert.match(workspace,/Сервер не повернув відповідь/);
  assert.match(workspace,/Сервер повернув некоректну відповідь/);
  const start=workspace.indexOf("async function changeWaitingCheck");
  const end=workspace.indexOf("function addedChats",start);
  assert.doesNotMatch(workspace.slice(start,end),/response\.json\(\)/);
});
