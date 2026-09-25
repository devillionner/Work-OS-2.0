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
  assert.match(dialog, /action:'start'/);
  assert.match(dialog, /runId:run\.id/);
  assert.match(dialog, /persistedBacklog=workspace\.candidates\.filter/);
  assert.match(dialog, /!candidate\.importedChatId/);
  assert.match(dialog, /продовжує до \$\{run\.goal\} цільових чатів/);
  assert.match(dialog, /work-os:chat-discovery-local-preview:v1/);
  assert.match(dialog, /sessionStorage/);
  assert.match(dialog, /Локально · не в D1/);
  assert.match(dialog, /Підходить → додати/);
  assert.match(previewRoute, /body\.action==='confirm'/);
  assert.match(previewDomain, /confirmLocalDiscoveryPreview/);
});

void test('browser-local source crawl uses targeted D1 dedupe and no owner-wide 10k scan', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /discoverTelegramPublic/);
  assert.match(preview, /discoverPublicWeb/);
  assert.match(preview, /normalized_link IN \(SELECT value FROM json_each\(\?2\)\)/);
  assert.doesNotMatch(preview, /LIMIT 10001/);
  const searchStart=preview.indexOf('export async function searchLocalDiscoveryPreview');
  const confirmStart=preview.indexOf('export async function confirmLocalDiscoveryPreview');
  const searchBody=preview.slice(searchStart,confirmStart);
  assert.doesNotMatch(searchBody,/INSERT INTO chat_discovery_candidates/);
});

void test('confirmed local preview is the persistence boundary', async () => {
  const [dialog, preview] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /action:'confirm'/);
  assert.match(dialog, /Відкинути локально/);
  assert.match(preview, /INSERT INTO chat_discovery_candidates/);
  assert.match(preview, /handoffDiscoveryCandidate/);
});

void test('Discovery executor source-crawls only for an explicit active autonomous run', async () => {
  const [runner, route, executor] = await Promise.all([
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/executor/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(runner,/queue\?\.sourceAdvanceNeeded===true/);
  assert.match(runner,/action:'advance-discovery'/);
  assert.match(runner,/SOURCE_ADVANCE_MS=60000/);
  assert.match(route,/advanceAutonomousDiscoveryRun/);
  assert.match(executor,/sourceAdvanceNeeded: latestRun\?\.status === 'running'/);
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
  assert.match(dialog, /Нових цільових чатів/);
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
  assert.match(dialog, /Кваліфікувати/);
  assert.match(dialog, /Потрібен підтверджений вихід із месенджера/);
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
  assert.match(dialog, /StatTile/);
});

void test('candidate cards present qualification as a compact criteria grid instead of a flat text wall', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidateCriteria\(candidate\)/);
  assert.match(dialog, /Що потребує уваги/);
  assert.match(dialog, /grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4/);
  assert.match(dialog, /Criterion/);
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
  assert.match(dialog, /Чат уже покинуто\. Для нової кваліфікації спочатку віднови його та підтвердь повторний вступ/);
});

void test('imported WhatsApp candidates have a manual qualification fallback using the inspection contract', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Кваліфікувати/);
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
  assert.match(panel, /native desktop path/);
  assert.match(panel, /не підтверджений target/);
});


void test('source name hints fail closed when they contain markup or URL noise', async () => {
  const preview = await readFile(new URL('../lib/chat-discovery/local-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /safeDiscoveryNameHint/);
  assert.match(preview, /src\|href\|class\|id/);
  assert.match(preview, /suggestedChatName/);
});
