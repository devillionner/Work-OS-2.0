import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate } from '../lib/business-time.ts';
import {
  generateTelegramSchedule,
  readTelegramSchedule,
  saveTelegramScheduleSettings,
} from '../lib/chats/telegram-schedule.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;
const DATE = businessDate(NOW);

async function seedAccount(db) {
  await db.prepare(`INSERT INTO telegram_accounts
    (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'A',1,1,1,1)`).run();
}

async function seedEligibleChat(db, id) {
  await seedChat(db, { id, platform: 'telegram', status: 'ready', joined: NOW - 21600 });
  await db.prepare(`UPDATE chats SET telegram_account_id='a' WHERE id=?1`).bind(id).run();
}

void test('manual schedule refuses to create empty slots when too few selected chats remain eligible', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db);
  await seedEligibleChat(db, 'one');
  await seedEligibleChat(db, 'two');
  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 8, baseAt: NOW, selectionMode: 'manual',
    manualChatIds: ['one'], now: NOW, date: DATE,
  });

  await assert.rejects(
    generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 2, now: NOW, date: DATE }),
    /Для 2 слотів вибрано лише 1 доступних чатів/,
  );
  assert.equal((await readTelegramSchedule(db, { userId: 'u', accountId: 'a', now: NOW, date: DATE })).slots.length, 0);
});

void test('manual schedule requires a selected chat before generation', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db);
  await seedEligibleChat(db, 'one');
  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 8, baseAt: NOW, selectionMode: 'manual',
    manualChatIds: [], now: NOW, date: DATE,
  });

  await assert.rejects(
    generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 1, now: NOW, date: DATE }),
    /вибрано лише 0 доступних чатів/,
  );
});
