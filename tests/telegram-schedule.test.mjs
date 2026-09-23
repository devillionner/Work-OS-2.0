import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate } from '../lib/business-time.ts';
import { recordManualPublication, undoManualPublication } from '../lib/chats/publication.ts';
import {
  clearPendingTelegramSchedule,
  generateTelegramSchedule,
  intervalMinutesForRate,
  ratePerHourForInterval,
  readTelegramSchedule,
  saveTelegramScheduleSettings,
  updateTelegramScheduleSlot,
} from '../lib/chats/telegram-schedule.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;
const DATE = businessDate(NOW);

async function seedAccount(db, id, owner = 'u', number = 1) {
  await db.prepare(`INSERT INTO telegram_accounts
    (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES (?1,?2,?3,?1,1,0,1,1)`).bind(id, owner, number).run();
}

async function telegramChat(db, id, accountId, options = {}) {
  await seedChat(db, {
    id, platform: 'telegram', status: options.status || 'ready',
    joined: options.joined ?? NOW - 21600,
    snoozed: options.snoozed ?? null,
  });
  await db.prepare('UPDATE chats SET telegram_account_id=?1 WHERE id=?2')
    .bind(accountId, id).run();
  return db.prepare(`SELECT c.*,${(await import('../lib/chats/state.ts')).chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1`).bind(id).first();
}
void test('tempo math is exact, fractional and has no 60/hour cap', () => {
  assert.equal(intervalMinutesForRate(15), 4);
  assert.equal(intervalMinutesForRate(7), 60 / 7);
  assert.equal(ratePerHourForInterval(4), 15);
  assert.equal(ratePerHourForInterval(0.5), 120);
  assert.throws(() => intervalMinutesForRate(0), /більшим за нуль/);
});

void test('generation is account-isolated, eligible-only and retry-idempotent', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await seedAccount(db, 'b', 'u', 2);
  await telegramChat(db, 'a-ready', 'a');
  await telegramChat(db, 'a-wait', 'a', { status: 'waiting' });
  await telegramChat(db, 'a-snoozed', 'a', { snoozed: NOW + 60 });
  await telegramChat(db, 'b-ready', 'b');
  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 4, baseAt: NOW, selectionMode: 'auto',
    manualChatIds: [], now: NOW, date: DATE,
  });
  let snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 2, now: NOW, date: DATE });
  assert.equal(snap.slots.length, 2);
  assert.equal(snap.slots[0].chatId, 'a-ready');
  assert.equal(snap.slots[1].chatId, null);
  assert.deepEqual(snap.slots.map((s) => s.scheduledAt), [NOW + 240, NOW + 480]);
  snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 2, now: NOW, date: DATE });
  assert.equal(snap.slots.length, 2);
  assert.equal((await readTelegramSchedule(db, { userId: 'u', accountId: 'b', now: NOW, date: DATE })).slots.length, 0);
});
void test('manual selection persists per account and slot edits do not shift other times', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await telegramChat(db, 'one', 'a');
  await telegramChat(db, 'two', 'a');
  await telegramChat(db, 'three', 'a');
  let snap = await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 8, baseAt: NOW, selectionMode: 'manual',
    manualChatIds: ['two', 'one'], now: NOW, date: DATE,
  });
  assert.deepEqual(snap.settings.manualChatIds, ['two', 'one']);
  snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 2, now: NOW, date: DATE });
  assert.deepEqual(snap.slots.map((s) => s.chatId), ['two', 'one']);
  const originalSecondTime = snap.slots[1].scheduledAt;
  snap = await updateTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'a', slotId: snap.slots[0].id, expectedVersion: snap.slots[0].version,
    scheduledAt: NOW + 333, chatId: null, now: NOW + 1, date: DATE,
  });
  assert.equal(snap.slots[0].scheduledAt, NOW + 333);
  assert.equal(snap.slots[0].chatId, null);
  assert.equal(snap.slots[1].scheduledAt, originalSecondTime);
  snap = await clearPendingTelegramSchedule(db, { userId: 'u', accountId: 'a', now: NOW + 2, date: DATE });
  assert.equal(snap.slots.length, 0);
});

void test('stale settings update is rejected and foreign or disabled accounts are inaccessible', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await seedAccount(db, 'foreign', 'other', 1);
  const first = await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 10, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });
  assert.equal(first.settings.version, 1);
  await assert.rejects(saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 9, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  }), /вже змінилися/);
  await assert.rejects(readTelegramSchedule(db, { userId: 'u', accountId: 'foreign', now: NOW, date: DATE }), /не знайдено/);
  await db.prepare("UPDATE telegram_accounts SET is_enabled=0 WHERE id='a'").run();
  await assert.rejects(readTelegramSchedule(db, { userId: 'u', accountId: 'a', now: NOW, date: DATE }), /не знайдено/);
});
void test('publication completes only the matching account slot and preserves other accounts', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await seedAccount(db, 'b', 'u', 2);
  const aChat = await telegramChat(db, 'a-chat', 'a');
  await telegramChat(db, 'b-chat', 'b');
  for (const accountId of ['a', 'b']) {
    await saveTelegramScheduleSettings(db, {
      userId: 'u', accountId, expectedVersion: 0,
      intervalMinutes: 4, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
    });
    await generateTelegramSchedule(db, { userId: 'u', accountId, count: 1, now: NOW, date: DATE });
  }
  const result = await recordManualPublication(db, {
    userId: 'u', chat: aChat, accountId: 'a', now: NOW + 1,
    date: DATE, stateToken: aChat.state_token,
  });
  assert.equal(result.ok, true);
  const a = await readTelegramSchedule(db, { userId: 'u', accountId: 'a', now: NOW + 1, date: DATE });
  const b = await readTelegramSchedule(db, { userId: 'u', accountId: 'b', now: NOW + 1, date: DATE });
  assert.equal(a.completed, 1);
  assert.equal(a.pending, 0);
  assert.equal(b.completed, 0);
  assert.equal(b.pending, 1);
  assert.equal(a.slots[0].chatId, 'a-chat');
  assert.ok(a.slots[0].completedAt);
});

void test('manual selection rejects chats from another account and duplicate pending assignment', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await seedAccount(db, 'b', 'u', 2);
  await telegramChat(db, 'a-chat', 'a');
  await telegramChat(db, 'b-chat', 'b');
  await assert.rejects(saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 8, baseAt: NOW, selectionMode: 'manual', manualChatIds: ['b-chat'], now: NOW, date: DATE,
  }), /недоступна/);
  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'a', expectedVersion: 0,
    intervalMinutes: 8, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });
  const snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'a', count: 2, now: NOW, date: DATE });
  await assert.rejects(updateTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'a', slotId: snap.slots[1].id, expectedVersion: snap.slots[1].version, chatId: 'a-chat', now: NOW + 1, date: DATE,
  }));
});
void test('scheduler respects confirmed profile publication rules', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await telegramChat(db, 'allowed-profile', 'a');
  await telegramChat(db, 'blocked-profile', 'a');
  await db.prepare(`INSERT INTO chat_profiles(chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES ('allowed-profile','uk','daily','[4]',NULL,NULL,'[]','','confirmed','manual',1),
           ('blocked-profile','uk','daily','[4]',NULL,'2026-09-11','[]','','confirmed','manual',1)`).run();
  const snap = await readTelegramSchedule(db, { userId:'u', accountId:'a', now:NOW, date:DATE });
  assert.deepEqual(snap.eligibleChats.map(chat=>chat.id), ['allowed-profile']);
});

void test('publication undo restores exactly the matching Telegram slot and keeps other accounts isolated', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'a', 'u', 1);
  await seedAccount(db, 'b', 'u', 2);
  const aChat = await telegramChat(db, 'undo-a-chat', 'a');
  await telegramChat(db, 'undo-b-chat', 'b');

  for (const accountId of ['a', 'b']) {
    await saveTelegramScheduleSettings(db, {
      userId:'u', accountId, expectedVersion:0, intervalMinutes:4, baseAt:NOW,
      selectionMode:'auto', manualChatIds:[], now:NOW, date:DATE,
    });
    await generateTelegramSchedule(db, { userId:'u', accountId, count:1, now:NOW, date:DATE });
  }

  const published = await recordManualPublication(db, {
    userId:'u', chat:aChat, accountId:'a', now:NOW+1, date:DATE, stateToken:aChat.state_token,
  });
  assert.equal(published.ok, true);
  const completedA = await readTelegramSchedule(db, { userId:'u', accountId:'a', now:NOW+1, date:DATE });
  const untouchedB = await readTelegramSchedule(db, { userId:'u', accountId:'b', now:NOW+1, date:DATE });
  assert.equal(completedA.completed, 1);
  assert.equal(untouchedB.pending, 1);

  const current = await (await import('../lib/chats/state.ts')).readChatState(db,'u','undo-a-chat');
  const undone = await undoManualPublication(db, { userId:'u', chat:current, now:NOW+2, date:DATE });
  assert.equal(undone.ok, true);

  const restoredA = await readTelegramSchedule(db, { userId:'u', accountId:'a', now:NOW+2, date:DATE });
  const stillUntouchedB = await readTelegramSchedule(db, { userId:'u', accountId:'b', now:NOW+2, date:DATE });
  assert.equal(restoredA.completed, 0);
  assert.equal(restoredA.pending, 1);
  assert.equal(restoredA.slots[0].chatId, 'undo-a-chat');
  assert.equal(restoredA.slots[0].publicationId, null);
  assert.equal(stillUntouchedB.completed, 0);
  assert.equal(stillUntouchedB.pending, 1);
});
