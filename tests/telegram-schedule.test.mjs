import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate } from '../lib/business-time.ts';
import { recordManualPublication, undoManualPublication } from '../lib/chats/publication.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import {
  archiveTelegramScheduleSlot,
  clearPendingTelegramSchedule,
  generateTelegramSchedule,
  intervalMinutesForRate,
  ratePerHourForInterval,
  readTelegramSchedule,
  saveTelegramScheduleSettings,
  unlinkTelegramScheduleSlot,
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
    profile: options.profile ?? true,
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
  await telegramChat(db, 'allowed-profile', 'a', { profile: false });
  await telegramChat(db, 'blocked-profile', 'a', { profile: false });
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
  assert.equal(await db.prepare("SELECT publication_id FROM telegram_schedule_slots WHERE id=?1").bind(restoredA.slots[0].id).first('publication_id'), null);
  assert.equal(stillUntouchedB.completed, 0);
  assert.equal(stillUntouchedB.pending, 1);
});

void test('generation does not waste eligible chats on past completed slots and fills empty pending slots', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'acc', 'u', 1);
  const chat1 = await telegramChat(db, 'chat-1', 'acc');
  const chat2 = await telegramChat(db, 'chat-2', 'acc');
  const chat3 = await telegramChat(db, 'chat-3', 'acc');

  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'acc', expectedVersion: 0,
    intervalMinutes: 10, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });

  // Generate 2 slots: slot 1 (NOW+600) -> chat-1, slot 2 (NOW+1200) -> chat-2
  await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 2, now: NOW, date: DATE });

  // Complete slot 1 with chat-1
  await recordManualPublication(db, {
    userId: 'u', chat: chat1, accountId: 'acc', now: NOW + 600, date: DATE, stateToken: chat1.state_token,
  });

  // Now clear chat from slot 2, leaving it pending without a chat
  const snapAfterPub = await readTelegramSchedule(db, { userId: 'u', accountId: 'acc', now: NOW + 700, date: DATE });
  await updateTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'acc', slotId: snapAfterPub.slots[1].id, expectedVersion: snapAfterPub.slots[1].version,
    chatId: null, now: NOW + 700, date: DATE,
  });

  // Available eligible chats now: chat-2, chat-3 (chat-1 is published today)
  // Re-run generate for 3 slots (slot 1 completed, slot 2 pending empty, slot 3 new)
  const snapNew = await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 3, now: NOW + 700, date: DATE });
  assert.equal(snapNew.slots.length, 3);
  assert.equal(snapNew.slots[0].status, 'completed');
  assert.equal(snapNew.slots[0].chatId, 'chat-1'); // completed stays untouched
  assert.equal(snapNew.slots[1].status, 'pending');
  assert.equal(snapNew.slots[1].chatId, 'chat-2'); // empty pending slot 2 received chat-2!
  assert.equal(snapNew.slots[2].status, 'pending');
  assert.equal(snapNew.slots[2].chatId, 'chat-3'); // new slot 3 received chat-3!
});

void test('schedule starts clean on next business day and past pending slots are cleaned up', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'acc', 'u', 1);
  const chat1 = await telegramChat(db, 'day1-chat1', 'acc');
  const chat2 = await telegramChat(db, 'day1-chat2', 'acc');

  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'acc', expectedVersion: 0,
    intervalMinutes: 10, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });

  // Generate slots for day 1
  await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 2, now: NOW, date: DATE });
  // Complete slot 1
  await recordManualPublication(db, {
    userId: 'u', chat: chat1, accountId: 'acc', now: NOW + 600, date: DATE, stateToken: chat1.state_token,
  });

  // Day 1 has 1 completed, 1 pending slot
  const day1Snap = await readTelegramSchedule(db, { userId: 'u', accountId: 'acc', now: NOW + 700, date: DATE });
  assert.equal(day1Snap.completed, 1);
  assert.equal(day1Snap.pending, 1);
  assert.equal(day1Snap.slots.length, 2);

  // Day 2 (tomorrow)
  const TOMORROW = NOW + 86400;
  const TOMORROW_DATE = businessDate(TOMORROW);

  // Reading tomorrow's schedule should return 0 slots (clean slate for the new day)
  const day2Snap = await readTelegramSchedule(db, { userId: 'u', accountId: 'acc', now: TOMORROW, date: TOMORROW_DATE });
  assert.equal(day2Snap.completed, 0);
  assert.equal(day2Snap.pending, 0);
  assert.equal(day2Snap.slots.length, 0);
  assert.equal(day2Snap.nextSlot, null);

  // Stale pending slot from day 1 was deleted, so chat2 is eligible on day 2 without conflict
  const day2Generated = await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 2, now: TOMORROW, date: TOMORROW_DATE });
  assert.equal(day2Generated.slots.length, 2);
  assert.equal(day2Generated.completed, 0);
  assert.equal(day2Generated.pending, 2);
});

void test('archiving or unlinking a slot shifts remaining chats up and assigns new eligible chat to last slot', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'acc', 'u', 1);
  const chat1 = await telegramChat(db, 'chat-1', 'acc');
  const chat2 = await telegramChat(db, 'chat-2', 'acc');
  const chat3 = await telegramChat(db, 'chat-3', 'acc');
  const chat4 = await telegramChat(db, 'chat-4', 'acc');
  const chat5 = await telegramChat(db, 'chat-5', 'acc');

  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'acc', expectedVersion: 0,
    intervalMinutes: 10, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });

  // Generate 3 slots with chat-1, chat-2, chat-3
  let snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 3, now: NOW, date: DATE });
  assert.equal(snap.slots[0].chatId, 'chat-1');
  assert.equal(snap.slots[1].chatId, 'chat-2');
  assert.equal(snap.slots[2].chatId, 'chat-3');

  // Archive slot 2 (chat-2) with reason 'Забанено'
  const slot2Id = snap.slots[1].id;
  snap = await archiveTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'acc', slotId: slot2Id,
    reason: 'Забанено', stateToken: chat2.state_token, now: NOW + 10, date: DATE,
  });

  // Verify chat-2 is archived in DB
  const archivedRow = await db.prepare("SELECT workflow_status, archive_reason FROM chats WHERE id='chat-2'").first();
  assert.equal(archivedRow.workflow_status, 'archived');
  assert.equal(archivedRow.archive_reason, 'Забанено');

  // Verify slots were reflowed:
  // Slot 1: chat-1 (unchanged)
  // Slot 2: chat-3 (shifted up from slot 3)
  // Slot 3: chat-4 (new eligible chat assigned to last slot!)
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.slots[0].chatId, 'chat-1');
  assert.equal(snap.slots[1].chatId, 'chat-3');
  assert.equal(snap.slots[2].chatId, 'chat-4');

  // Now archive slot 1 (chat-1) with reason 'Чат не цільовий'
  const slot1Id = snap.slots[0].id;
  snap = await archiveTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'acc', slotId: slot1Id,
    reason: 'Чат не цільовий', stateToken: chat1.state_token, now: NOW + 20, date: DATE,
  });

  // Verify chat-1 is archived in DB
  const archivedRow1 = await db.prepare("SELECT workflow_status, archive_reason FROM chats WHERE id='chat-1'").first();
  assert.equal(archivedRow1.workflow_status, 'archived');
  assert.equal(archivedRow1.archive_reason, 'Чат не цільовий');

  // Verify slots reflowed after archiving slot 1:
  // Slot 1: chat-3 (shifted up from slot 2)
  // Slot 2: chat-4 (shifted up from slot 3)
  // Slot 3: chat-5 (new eligible chat assigned to last slot!)
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.slots[0].chatId, 'chat-3');
  assert.equal(snap.slots[1].chatId, 'chat-4');
  assert.equal(snap.slots[2].chatId, 'chat-5');

  // Now unlink slot 1 (chat-3)
  const currentSlot1Id = snap.slots[0].id;
  snap = await unlinkTelegramScheduleSlot(db, {
    userId: 'u', accountId: 'acc', slotId: currentSlot1Id, now: NOW + 30, date: DATE,
  });

  // Unlinked chat-3 is still ready, so it becomes eligible again and fills the last slot:
  // Slot 1: chat-4 (shifted up from slot 2)
  // Slot 2: chat-5 (shifted up from slot 3)
  // Slot 3: chat-3 (re-eligible chat fills the last slot!)
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.slots[0].chatId, 'chat-4');
  assert.equal(snap.slots[1].chatId, 'chat-5');
  assert.equal(snap.slots[2].chatId, 'chat-3');
});

void test('archiving or modifying chat outside schedule auto-heals and reflows plan on read', async (t) => {
  const db = await localDatabase(t);
  await seedAccount(db, 'acc', 'u', 1);
  const chat1 = await telegramChat(db, 'chat-1', 'acc');
  const chat2 = await telegramChat(db, 'chat-2', 'acc');
  const chat3 = await telegramChat(db, 'chat-3', 'acc');
  const chat4 = await telegramChat(db, 'chat-4', 'acc');
  const chat5 = await telegramChat(db, 'chat-5', 'acc');

  await saveTelegramScheduleSettings(db, {
    userId: 'u', accountId: 'acc', expectedVersion: 0,
    intervalMinutes: 10, baseAt: NOW, selectionMode: 'auto', manualChatIds: [], now: NOW, date: DATE,
  });

  // Generate 3 slots with chat-1, chat-2, chat-3
  let snap = await generateTelegramSchedule(db, { userId: 'u', accountId: 'acc', count: 3, now: NOW, date: DATE });
  assert.equal(snap.slots[0].chatId, 'chat-1');
  assert.equal(snap.slots[1].chatId, 'chat-2');
  assert.equal(snap.slots[2].chatId, 'chat-3');

  // Archive chat-2 via standard transitionChat (outside schedule, like from chats table)
  const result = await transitionChat(db, {
    userId: 'u',
    chat: chat2,
    action: 'archive',
    accountId: 'acc',
    now: NOW + 10,
    reason: 'Забанено',
  });
  assert.equal(result.ok, true);

  // When schedule is read (e.g. refreshed in UI), it automatically heals and reflows:
  // Slot 1: chat-1 (stays)
  // Slot 2: chat-3 (shifted up)
  // Slot 3: chat-4 (filled with next eligible chat)
  snap = await readTelegramSchedule(db, { userId: 'u', accountId: 'acc', now: NOW + 20, date: DATE });
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.slots[0].chatId, 'chat-1');
  assert.equal(snap.slots[1].chatId, 'chat-3');
  assert.equal(snap.slots[2].chatId, 'chat-4');

  // Snooze chat-1 for 3 days
  await db.prepare("UPDATE chats SET snoozed_until=?1 WHERE id='chat-1' AND user_id='u'").bind(NOW + 86400 * 3).run();

  // Next read auto-heals again:
  // Slot 1: chat-3 (shifted up)
  // Slot 2: chat-4 (shifted up)
  // Slot 3: chat-5 (filled with next eligible chat)
  snap = await readTelegramSchedule(db, { userId: 'u', accountId: 'acc', now: NOW + 30, date: DATE });
  assert.equal(snap.slots.length, 3);
  assert.equal(snap.slots[0].chatId, 'chat-3');
  assert.equal(snap.slots[1].chatId, 'chat-4');
  assert.equal(snap.slots[2].chatId, 'chat-5');
});




