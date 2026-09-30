import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Platforms exposes an explicit autonomous outcome loop plus a local manual fallback', async () => {
  const [workspace, dialog, previewRoute, previewDomain] = await Promise.all([
    readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/preview/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /ChatDiscoveryDialog/);
  assert.match(workspace, /Знайти чати/);
  assert.match(dialog, /Запустити автопошук/);
  assert.doesNotMatch(dialog, /action:'start'/);
  assert.match(dialog, /work-os:chat-discovery-local-preview:v3/);
  assert.match(dialog, /running:true/);
  assert.match(dialog, /LOCAL_SOURCE_SEEDS_KEY/);
  assert.match(dialog, /localTargets\.length/);
  assert.match(dialog, /цільових у Work OS/);
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /sessionStorage/);
  assert.match(dialog, /Відхилити/);
  assert.match(previewRoute, /body\.action==='confirm'/);
  assert.match(previewDomain, /confirmLocalDiscoveryPreview/);
});

void test('local autonomous preflight exposes only factual targets before D1 confirmation', async () => {
  const [dialog, runner, preview] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog,/LOCAL_PREFLIGHT_RESULTS_KEY/);
  assert.match(dialog,/preflightState==='target'/);
  assert.match(dialog,/emptyCandidateCopy/);
  assert.match(runner,/readWorkOsLocalDiscoveryTaskViaCdp/);
  assert.match(runner,/writeWorkOsLocalDiscoveryResultViaCdp/);
  assert.match(runner,/approval_required/);
  assert.match(preview,/До D1 можна підтвердити лише фактично перевірений цільовий чат/);
});

void test('browser-local source crawl uses targeted D1 dedupe and no owner-wide 10k scan', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /buildTelegramSearchPlan\(telegramCursor,3\)/);
  assert.match(preview, /maxQueries:3,pageLimit:1/);
  assert.match(preview, /maxQueries:3,pageLimit:1/);
  assert.match(preview, /normalized_link IN \(SELECT value FROM json_each\(\?2\)\)/);
  assert.doesNotMatch(preview, /LIMIT 10001/);
  const searchStart=preview.indexOf('export async function searchLocalDiscoveryPreview');
  const confirmStart=preview.indexOf('export async function confirmLocalDiscoveryPreview');
  const searchBody=preview.slice(searchStart,confirmStart);
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
  const [runner, route, executor] = await Promise.all([
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/executor/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(runner,/function canAdvanceDiscoverySource\(\)\{\s*return false;/);
  assert.match(route,/Source discovery тепер локальний і не пише проміжні результати в D1/);
  assert.doesNotMatch(route,/advanceAutonomousDiscoveryRun/);
  assert.match(executor,/sourceAdvanceNeeded: false/);
  assert.doesNotMatch(executor,/SELECT min_members,status FROM chat_discovery_runs/);
});

void test('local WhatsApp outcomes persist as durable dedupe without auto-importing targets', async()=>{
  const [previewRoute,previewDomain,adapter,dialog,domain]=await Promise.all([
    readFile(new URL('../app/api/chat-discovery/preview/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts',import.meta.url),'utf8'),
    readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts',import.meta.url),'utf8'),
  ]);
  assert.match(previewRoute,/body\.action==='persist-outcome'/);
  assert.match(previewDomain,/persistLocalDiscoveryOutcome/);
  assert.match(previewDomain,/decision='target'/);
  assert.match(adapter,/action:'persist-outcome'/);
  assert.match(adapter,/persisted\?\.persisted/);
  assert.match(dialog,/Ручна перевірка/);
  assert.match(dialog,/Дані пошуку/);
  const reset=domain.slice(domain.indexOf('export async function resetDiscoveryWorkspace'),domain.indexOf('export async function continueDiscoveryRun'));
  assert.match(reset,/preservedCandidates/);
  assert.doesNotMatch(reset,/DELETE FROM chat_discovery_candidates/);
});

void test('saved target is an explicit operator decision point', async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/archiveCandidate\(candidate/);
  assert.match(dialog,/action:'archive-candidate'/);
  assert.match(dialog,/operator_rejected/);
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
  assert.match(executor, /platform='whatsapp' AND membership_state='pending'/);
});

void test('Chat Discovery modal uses a wide split layout with independent candidate scrolling', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /!max-w-\[1240px\]/);
  assert.match(dialog, /h-\[min\(92dvh,920px\)\]/);
  assert.match(dialog, /lg:grid-cols-\[330px_minmax\(0,1fr\)\]/);
  assert.match(dialog, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(dialog, /Фільтр кандидатів/);
  assert.match(dialog, /Автопошук WhatsApp-чатів/);
  assert.match(dialog, /Потрібен мій погляд/);
  assert.doesNotMatch(dialog, /StatTile/);
});

void test('candidate cards lead with human-readable automation status and keep criteria collapsed', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidateStatus\(candidate\)/);
  assert.match(dialog, /Перевірені критерії ·/);
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
  assert.match(dialog, /label: 'Активність'/);
  assert.match(dialog, /label: 'Можна писати'/);
  assert.match(dialog, /label: 'Оголошення'/);
  assert.match(dialog, /label: 'Аудиторія'/);
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
  assert.match(dialog, /У роботі/);
  assert.match(dialog, /Потрібен погляд/);
  assert.match(dialog, /Відсіяно/);
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /Підключення WhatsApp/);
  assert.doesNotMatch(dialog, /<StatTile/);
});

void test('Discovery shows a simple activity time without a ticking countdown', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Дані пошуку/);
  assert.match(dialog, /formatActivityTime\(localPreview\.lastActivityAt\)/);
  assert.match(dialog, /hour:'2-digit',minute:'2-digit'/);
  assert.doesNotMatch(dialog, /Пошукових кроків/);
  assert.doesNotMatch(dialog, /lastRunActivitySeconds|setInterval\(\(\)=>setClockMs/);
  assert.doesNotMatch(dialog, /workspace\.run\?\.status!=='running'/);
});


void test('Discovery merges local and persisted outcomes into one logical result', async () => {
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/mergeDiscoveryCandidates\(workspace\.candidates,visibleLocal\)/);
  assert.match(dialog,/candidateIdentity\(candidate\)/);
  assert.match(dialog,/workspaceLoadedAt/);
  assert.doesNotMatch(dialog,/workspace\.counts\.review\+localManualReview/);
  assert.match(dialog,/Джерела вичерпано: фактично підтверджено \{localTargets\.length\}/);
});

void test('Preview API transient HTML/5xx does not stop local autonomous search', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog,/const attempts=body\.action==='search'\?3:1/);
  assert.match(dialog,/Preview API повернув не-JSON відповідь/);
  assert.match(dialog,/response\.status>=500/);
  assert.match(dialog,/await new Promise\(resolve=>window\.setTimeout\(resolve,750\*attempt\)\)/);
  assert.match(dialog,/throw new Error\(lastError\)/);
});

void test('local Discovery continues when the modal is closed', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.ok(dialog.includes("setLocalPreview(readLocalPreviewSession())"));
  assert.ok(dialog.includes("if(!localPreviewHydrated)return;"));
  assert.ok(dialog.includes("if(!localPreviewHydrated||!localPreview.running)return;"));
  assert.equal(dialog.includes("if(!open||!localPreviewHydrated||!localPreview.running)return;"), false);
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


void test('source pacing lives in the external runner instead of a fast modal polling loop', async () => {
  const [dialog,runner]=await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url),'utf8'),
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url),'utf8'),
  ]);
  assert.match(runner,/const LOCAL_SOURCE_MIN_MS=500/);
  assert.match(runner,/applied\.errors\?10_000:LOCAL_SOURCE_MIN_MS/);
  assert.doesNotMatch(dialog,/\},350\);/);
});


void test('each autonomous source request is a single bounded task and public search is interleaved every third batch', async () => {
  const preview=await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url),'utf8');
  assert.match(preview,/const batchSize=1/);
  assert.match(preview,/completedBatches%3===2/);
});

void test('autonomous start is synchronously visible to the external CDP runner',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const start=dialog.slice(dialog.indexOf('async function startAutonomousSearch'),dialog.indexOf('async function stopAutonomousSearch'));
  assert.match(start,/sessionStorage\.setItem\(LOCAL_PREVIEW_KEY,JSON\.stringify\(nextRun\)\)/);
  assert.match(start,/setLocalPreview\(nextRun\)/);
  assert.ok(start.indexOf('sessionStorage.setItem(LOCAL_PREVIEW_KEY')<start.indexOf('setLocalPreview(nextRun)'));
});

void test('live WhatsApp check state survives UI session normalization',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/activeCandidateName:typeof value\.activeCandidateName==='string'/);
  assert.match(dialog,/lastCheckedName:typeof value\.lastCheckedName==='string'/);
  assert.match(dialog,/lastCheckedDecision:value\.lastCheckedDecision==='review'\|\|value\.lastCheckedDecision==='target'/);
  assert.match(dialog,/lastCheckedName:typeof value\.lastCheckedName==='string'/);
  assert.match(dialog,/Перевіряємо WhatsApp:/);
});

void test('pausing autonomous discovery preserves unfinished candidates and momentum',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const stop=dialog.slice(dialog.indexOf('async function stopAutonomousSearch'),dialog.indexOf('function retryIncompleteCandidate'));
  assert.match(stop,/running:false/);
  assert.match(stop,/candidate\.preflightState==='queued'/);
  assert.doesNotMatch(stop,/action:'persist-outcome'/);
  assert.doesNotMatch(stop,/paused_unverified/);
  assert.match(stop,/pauseSummary/);
  assert.match(stop,/telegramCursor/);
  assert.match(dialog,/Останній запуск зупинено/);
  assert.match(dialog,/прогрес збережено/);
});

void test('resuming a paused discovery run keeps cursor candidates and durable dedupe history',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  const start=dialog.slice(dialog.indexOf('async function startAutonomousSearch'),dialog.indexOf('async function stopAutonomousSearch'));
  assert.match(start,/if\(localPreview\.pauseSummary&&!localPreview\.done\)/);
  assert.match(start,/\.\.\.localPreview/);
  assert.match(start,/runId:crypto\.randomUUID\(\)/);
  assert.match(start,/pauseSummary:null/);
  assert.match(start,/Уже відомі invite повторно не перевіряються/);
  const resumeBlock=start.slice(start.indexOf('if(localPreview.pauseSummary'));
  assert.doesNotMatch(resumeBlock,/\.\.\.EMPTY_LOCAL_PREVIEW/);
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
  assert.match(dialog,/Ручна перевірка/);
  assert.match(dialog,/preflightState==='review'/);
  assert.match(dialog,/WhatsApp не показує стару історію/);
  assert.match(preview,/\['review','target','rejected','skipped','unavailable'\]/);
  assert.match(runner,/fresh_join_history_unavailable/);
  assert.doesNotMatch(runner,/POST_JOIN_EVIDENCE_RECHECK_MS/);
});

void test('Discovery exposes primary review actions directly and uses contextual empty states',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/Додати на ручну перевірку/);
  assert.match(dialog,/Відхилити/);
  assert.match(dialog,/Ручна перевірка порожня/);
  assert.match(dialog,/Цільових чатів поки немає/);
  assert.doesNotMatch(dialog,/xl:grid-cols-6/);
  assert.match(dialog,/Потрібен мій погляд/);
  assert.match(dialog,/!w-\[calc\(100dvw-20px\)\]/);
  assert.match(dialog,/sm:!w-\[calc\(100dvw-32px\)\]/);
  assert.match(dialog,/min-h-11/);
});

void test('Discovery UI explains browser progress versus durable Work OS decisions without backend jargon',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/Знаходить і перевіряє чати сам/);
  assert.match(dialog,/Дані пошуку/);
  assert.match(dialog,/Підключення WhatsApp/);
  assert.doesNotMatch(dialog,/Persistent dedupe/);
  assert.doesNotMatch(dialog,/Сирі invite в D1/);
});


void test('stale source cooldown warnings disappear after pause and resume',async()=>{
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/autonomousRunning&&localPreview\.sourceIssues\.length>0/);
  const stop=dialog.slice(dialog.indexOf('async function stopAutonomousSearch'),dialog.indexOf('function retryIncompleteCandidate'));
  assert.match(stop,/sourceFailures:0,sourceIssues:\[\]/);
  const start=dialog.slice(dialog.indexOf('async function startAutonomousSearch'),dialog.indexOf('async function stopAutonomousSearch'));
  assert.match(start,/sourceFailures:0,/);
  assert.match(start,/sourceIssues:\[\]/);
});
