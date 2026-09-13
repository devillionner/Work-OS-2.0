import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';
import {
  CHAT_SNOOZE_ARCHIVE_THRESHOLD,
  readChatSnoozeCount,
  shouldSuggestChatArchive,
} from '../lib/chats/snooze.ts';

void test('archive suggestion starts after the third snooze', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db);

  assert.equal(await readChatSnoozeCount(db, 'u', 'chat'), 0);
  assert.equal(shouldSuggestChatArchive(0), false);
  assert.equal(shouldSuggestChatArchive(CHAT_SNOOZE_ARCHIVE_THRESHOLD - 1), false);
  assert.equal(shouldSuggestChatArchive(CHAT_SNOOZE_ARCHIVE_THRESHOLD), true);

  for (let index = 1; index <= 3; index++) {
    await seedEvent(db, {
      id: `snooze-${index}`,
      type: 'chat_state_changed',
      date: '2026-09-13',
      at: 100 + index,
      chat: 'chat',
      metadata: { action: 'snooze' },
    });
  }
  await seedEvent(db, {
    id: 'unsnooze',
    type: 'chat_state_changed',
    date: '2026-09-13',
    chat: 'chat',
    metadata: { action: 'unsnooze' },
  });

  assert.equal(await readChatSnoozeCount(db, 'u', 'chat'), 3);
  assert.equal(shouldSuggestChatArchive(await readChatSnoozeCount(db, 'u', 'chat')), true);
});

void test('snooze count is owner and chat scoped', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db);
  await seedChat(db, { id: 'other-chat', owner: 'other' });
  await seedEvent(db, {
    id: 'mine', owner: 'u', type: 'chat_state_changed', date: '2026-09-13',
    chat: 'chat', metadata: { action: 'snooze' },
  });
  await seedEvent(db, {
    id: 'foreign', owner: 'other', type: 'chat_state_changed', date: '2026-09-13',
    chat: 'other-chat', metadata: { action: 'snooze' },
  });

  assert.equal(await readChatSnoozeCount(db, 'u', 'chat'), 1);
  assert.equal(await readChatSnoozeCount(db, 'u', 'other-chat'), 0);
  assert.equal(await readChatSnoozeCount(db, 'other', 'other-chat'), 1);
});
