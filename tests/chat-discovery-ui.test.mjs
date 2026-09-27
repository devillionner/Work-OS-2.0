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
  assert.match(dialog, /action:'search'/);
  assert.match(dialog, /localTargets\.length/);
  assert.match(dialog, /цільових у Work OS/);
  assert.match(dialog, /D1 writes = 0/);
  assert.match(dialog, /sessionStorage/);
  assert.match(dialog, /Відкинути preview/);
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
  assert.match(dialog,/Тут з'являються тільки підтверджені цільові чати/);
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

void test('confirmed local preview is the persistence boundary', async () => {
  const [dialog, preview] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /action:'confirm'/);
  assert.match(dialog, /Відкинути preview/);
  assert.match(preview, /INSERT INTO chat_discovery_candidates/);
  assert.match(preview, /handoffDiscoveryCandidate/);
});

void test('Discovery executor cannot source-crawl or persist search candidates before operator confirmation', async () => {
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

void test('manual Telegram recovery stays local until confirmation', async () => {
  const [dialog, previewRoute] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/preview/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Ручне джерело з Telegram/);
  assert.match(dialog, /Додати локально/);
  assert.match(dialog, /Додати локально й очистити/);
  assert.match(dialog, /action:'telegram'/);
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
  assert.match(dialog, /Автопошук працює/);
  assert.match(dialog, /У D1 нічого не записується/);
  assert.match(dialog, /StatTile/);
});

void test('candidate cards lead with human-readable automation status and keep criteria collapsed', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidateStatus\(candidate\)/);
  assert.match(dialog, /Деталі перевірки · підтверджено/);
  assert.match(dialog, /grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4/);
  assert.match(dialog, /Ручні дії/);
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
  assert.match(dialog, /label: 'Вступ'/);
  assert.match(dialog, /label: 'Перевірка'/);
  assert.match(dialog, /label: 'Invite'/);
  assert.match(dialog, /label: 'Доступ'/);
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
  assert.match(dialog, /із \{displayedGoal\} підтверджених цільових/);
  assert.match(dialog, /Знайдено invite/);
  assert.match(dialog, /Перевірено WhatsApp/);
  assert.match(dialog, /Відсіяно/);
  assert.match(dialog, /Дублі \/ відомі/);
  assert.match(dialog, /Технічні деталі/);
  assert.match(dialog, /Локальний WhatsApp executor/);
  assert.match(dialog, /D1 writes до підтвердження/);
  assert.doesNotMatch(dialog, /<StatTile label="Query"/);
});

void test('Discovery shows live source progress without recurring D1 workspace polling', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Пошукових запитів:/);
  assert.match(dialog, /пакетами до 6/);
  assert.match(dialog, /lastRunActivitySeconds/);
  assert.match(dialog, /setInterval\(\(\)=>setClockMs\(Date\.now\(\)\),1000\)/);
  assert.doesNotMatch(dialog, /workspace\.run\?\.status!=='running'/);
  assert.doesNotMatch(dialog, /delayMs=nextUpdated/);
});


void test('factual target tab becomes the active local-run view and source exhaustion reports factual count', async () => {
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx',import.meta.url),'utf8');
  assert.match(dialog,/setFilter\('target'\)/);
  assert.match(dialog,/Джерела вичерпано: фактично підтверджено \{localTargets\.length\}/);
  assert.match(dialog,/фактично цільовий чат записано в D1 як уже приєднаний і готовий/);
});

void test('Preview API transient HTML/5xx does not stop local autonomous search', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog,/const attempts=body\.action==='search'\?3:1/);
  assert.match(dialog,/Preview API повернув не-JSON відповідь/);
  assert.match(dialog,/response\.status>=500/);
  assert.match(dialog,/Автопошук продовжить спроби автоматично/);
  assert.match(dialog,/running:true,lastActivityAt:Date\.now\(\)/);
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
  assert.match(preview,/maxQueries:3,pageLimit:1/);
  assert.match(preview,/includeCurated:false/);
  assert.doesNotMatch(preview,/includeCurated:true/);
  assert.match(publicWeb,/MAX_PAGE_BYTES = 650_000/);
  assert.match(publicWeb,/if\(!hasRequestedInvite\)return \[\]/);
});


void test('empty Discovery source batches back off instead of hammering the Worker every 350ms', async () => {
  const dialog=await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url),'utf8');
  assert.match(dialog,/emptySourceBatches>=6\?10_000/);
  assert.match(dialog,/emptySourceBatches>=3\?5_000/);
  assert.match(dialog,/emptySourceBatches>=1\?2_000:700/);
  assert.doesNotMatch(dialog,/\},350\);/);
});
