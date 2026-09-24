import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Platforms exposes a real Chat Discovery workflow instead of an API-only feature', async () => {
  const [workspace, dialog] = await Promise.all([
    readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /ChatDiscoveryDialog/);
  assert.match(workspace, /Знайти чати/);
  assert.match(dialog, /Запустити автопошук/);
  assert.match(dialog, /Нових цільових чатів/);
  assert.match(dialog, /Зупинити автопошук/);
  assert.match(dialog, /Додати на перевірку/);
  assert.match(dialog, /Звідки знайдено/);
  assert.match(dialog, /unknown_member_count/);
  assert.match(dialog, /unknown_invite_validity/);
  assert.match(dialog, /unknown_access/);
  assert.match(dialog, /run\.targetCount/);
  assert.doesNotMatch(dialog, /while \(run\.status === 'running'/);
});

void test('discovery UI goal means confirmed targets and needs no keyword, city or time input', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Нових цільових чатів/);
  assert.match(dialog, /useState\(50\)/);
  assert.match(dialog, /const minMembers = 700/);
  assert.match(dialog, /весь seed-корпус міст і ключових шаблонів сам/);
  assert.match(dialog, /тільки нові підтверджені WhatsApp-чати/);
  assert.doesNotMatch(dialog, /id="discovery-min-members"/);
});


void test('discovery UI exposes membership, inspection and post-join cleanup states', async () => {
  const [dialog, route] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Очікує схвалення/);
  assert.match(dialog, /Приєднано/);
  assert.match(dialog, /'Перевірено'/);
  assert.doesNotMatch(dialog, /Автоперевірено|Автоперевірка не завершена/);
  assert.match(dialog, /Заповни кваліфікацію нижче/);
  assert.match(dialog, /Потрібен підтверджений вихід із месенджера/);
  assert.match(route, /body\.action === 'inspect'/);
  assert.match(route, /applyDiscoveryInspection/);
});

void test('WhatsApp waiting is a dedicated server-filtered queue with an executor count', async () => {
  const [dialog, route, domain, executor] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/executor.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /WA · Очікування/);
  assert.match(dialog, /waitingWhatsApp/);
  assert.match(route, /waitingWhatsApp.*=== '1'/);
  assert.match(domain, /platform='whatsapp' AND membership_state='pending'/);
  assert.match(executor, /platform='whatsapp' AND membership_state='pending'/);
});

void test('manual Telegram ingestion remains a collapsed recovery fallback, not the primary workflow', async () => {
  const [dialog, route] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Recovery: ручне Telegram-джерело/);
  assert.match(dialog, /Ручний Telegram fallback/);
  assert.match(dialog, /Не потрібен для звичайного автопошуку/);
  assert.match(dialog, /Результати пошуку Telegram/);
  assert.match(dialog, /Зберегти джерело/);
  assert.match(dialog, /Завершити query → наступний/);
  assert.match(dialog, /action: 'ingest-telegram'/);
  assert.match(route, /body\.action === 'ingest-telegram'/);
  assert.match(route, /ingestTelegramDiscovery/);
});

void test('autonomous seed plan is primary and public web fallback is server-owned', async () => {
  const [dialog, domain, runner] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/chat-discovery-runner.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Запустити автопошук/);
  assert.match(dialog, /Цільові: <strong[^>]*>\{run\.targetCount\} \/ \{run\.goal\}/);
  assert.doesNotMatch(dialog, />Web fallback</);
  assert.match(domain, /advanceAutonomousDiscoveryRun/);
  assert.match(domain, /discoverTelegramPublic/);
  assert.match(domain, /buildTelegramSearchPlan/);
  assert.match(domain, /buildPublicSearchTasks/);
  assert.match(runner, /action:'advance-discovery'/);
});

void test('Telegram ingestion and advancement use the persistent plan query as the only query source', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dialog, /useState\(''\).*telegramQuery|setTelegramQuery/);
  assert.match(dialog, /const displayedQuery = workspace\.telegramPlan\?\.tasks\[0\]\?\.query \|\| ''/);
  assert.match(dialog, /const fresh = await load\(filter\)/);
  assert.match(dialog, /freshQuery !== displayedQuery/);
  assert.match(dialog, /Скан не передано — оновіть поточний query/);
  assert.match(dialog, /const query = displayedQuery/);
  assert.doesNotMatch(dialog, /processedQuery:/);
  assert.match(dialog, /aria-readonly="true"/);
  assert.match(dialog, /workspace\.run\?\.status !== 'running' \|\| !currentTask\?\.query/);
  assert.match(dialog, /required=\{telegramHasInvite\}/);
  assert.match(dialog, /telegramHasInvite && \(!telegramSourceTitle\.trim\(\) \|\| !telegramSourceUrl\.trim\(\)\)/);
});

void test('Telegram UI can save multiple source chats before completing the current query', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /ingestTelegramScan\(false\)/);
  assert.match(dialog, /ingestTelegramScan\(true\)/);
  assert.match(dialog, /«Зберегти джерело» не рухає план/);
  assert.match(dialog, /«Завершити query» просуває cursor рівно на один крок/);
  assert.match(dialog, /telegramText\.replaceAll\('\\\\\/', '\/'\)/);
});

void test('Chat Discovery modal uses a wide split layout with independent candidate scrolling', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /!max-w-\[1180px\]/);
  assert.match(dialog, /h-\[min\(92dvh,940px\)\]/);
  assert.match(dialog, /lg:grid-cols-\[minmax\(0,0\.92fr\)_minmax\(460px,1\.08fr\)\]/);
  assert.match(dialog, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(dialog, /Фільтр кандидатів/);
  assert.match(dialog, /StatTile/);
});

void test('candidate cards present qualification as a compact criteria grid instead of a flat text wall', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /candidateCriteria\(candidate\)/);
  assert.match(dialog, /Що потребує уваги/);
  assert.match(dialog, /grid-cols-2 gap-1\.5 sm:grid-cols-3/);
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
