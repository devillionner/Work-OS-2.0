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
  assert.match(dialog, /Почати пошук/);
  assert.match(dialog, /Продовжити пошук/);
  assert.match(dialog, /Зупинити/);
  assert.match(dialog, /Додати на перевірку/);
  assert.match(dialog, /Звідки знайдено/);
  assert.match(dialog, /unknown_member_count/);
  assert.match(dialog, /while \(run\.status === 'running'/);
});

void test('discovery UI keeps candidate goal distinct from confirmed target qualification', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Нових кандидатів за запуск/);
  assert.match(dialog, /Мінімум учасників для target/);
  assert.match(dialog, /Невідомі критерії не вважаються підтвердженими/);
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
  assert.match(dialog, /Передати Telegram-скан/);
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
  assert.match(dialog, /Опрацьовано → наступний/);
  assert.match(dialog, /Додатковий web-пошук/);
  assert.match(dialog, /run\.telegramCursor/);
  assert.match(route, /body\.action === 'advance-telegram-plan'/);
  assert.match(domain, /telegram_cursor/);
  assert.match(domain, /buildTelegramSearchPlan/);
});

void test('candidate cards expose the WhatsApp link and every target qualification criterion', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Відкрити WhatsApp/);
  assert.match(dialog, /Учасники:/);
  assert.match(dialog, /Активність:/);
  assert.match(dialog, /Писати:/);
  assert.match(dialog, /Оголошення:/);
  assert.match(dialog, /Аудиторія:/);
  assert.match(dialog, /adsPolicyLabel/);
  assert.match(dialog, /topicMatchLabel/);
});

void test('operators can reject an invalid WhatsApp invite before creating a chat', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Invite недійсний/);
  assert.match(dialog, /invalid_whatsapp_link/);
  assert.match(dialog, /кандидат відхилено без створення чату/);
});
