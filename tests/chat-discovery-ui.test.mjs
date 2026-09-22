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
  assert.match(dialog, /Почати Telegram-пошук/);
  assert.match(dialog, /Web fallback/);
  assert.match(dialog, /Зупинити/);
  assert.match(dialog, /Додати на перевірку/);
  assert.match(dialog, /Звідки знайдено/);
  assert.match(dialog, /unknown_member_count/);
  assert.match(dialog, /unknown_invite_validity/);
  assert.match(dialog, /unknown_access/);
  assert.match(dialog, /while \(run\.status === 'running'/);
});

void test('discovery UI keeps candidate goal distinct from confirmed target qualification', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Нових кандидатів за запуск/);
  assert.match(dialog, /Мінімум учасників для target/);
  assert.match(dialog, /Невідомі критерії не зараховуються/);
});


void test('discovery UI exposes membership, inspection and post-join cleanup states', async () => {
  const [dialog, route] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Очікує схвалення/);
  assert.match(dialog, /Приєднано/);
  assert.match(dialog, /Автоперевірено/);
  assert.match(dialog, /потрібна кваліфікація/i);
  assert.match(dialog, /Потрібен підтверджений вихід із месенджера/);
  assert.match(route, /body\.action === 'inspect'/);
  assert.match(route, /applyDiscoveryInspection/);
});

void test('discovery UI exposes the Telegram to WhatsApp ingestion bridge', async () => {
  const [dialog, route] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Telegram → WhatsApp/);
  assert.match(dialog, /Результати пошуку Telegram/);
  assert.match(dialog, /Зберегти джерело/);
  assert.match(dialog, /Завершити query → наступний/);
  assert.match(dialog, /action: 'ingest-telegram'/);
  assert.match(route, /body\.action === 'ingest-telegram'/);
  assert.match(route, /ingestTelegramDiscovery/);
});

void test('Telegram keyword plan is the primary discovery flow and public web is explicitly fallback', async () => {
  const [dialog, route, domain] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(dialog, /Почати Telegram-пошук/);
  assert.match(dialog, /Черга Telegram-запитів/);
  assert.match(dialog, /лише «Завершити query» переходить до наступного/);
  assert.match(dialog, /Web fallback/);
  assert.match(dialog, /run\.telegramCursor/);
  assert.doesNotMatch(route, /body\.action === 'advance-telegram-plan'/);
  assert.match(domain, /telegram_cursor/);
  assert.match(domain, /buildTelegramSearchPlan/);
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
  assert.match(dialog, /workspace\.run\?\.status !== 'running' \|\| !workspace\.telegramPlan\?\.tasks\[0\]\?\.query/);
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
  assert.match(dialog, /Відкрити WhatsApp/);
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
