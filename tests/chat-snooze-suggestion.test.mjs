import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';
import { readChatState } from '../lib/chats/state.ts';
import {
  CHAT_SNOOZE_ARCHIVE_THRESHOLD,
  applyChatSnoozeAction,
  readChatSnoozeCount,
  shouldSuggestChatArchive,
} from '../lib/chats/snooze.ts';

const NOW = Date.parse('2026-09-13T12:00:00Z') / 1000;

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

void test('successful third snooze returns an actionable archive signal', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { status: 'waiting' });
  for (let index = 1; index <= 2; index++) {
    await seedEvent(db, {
      id: `prior-snooze-${index}`, type: 'chat_state_changed', date: '2026-09-13',
      at: 100 + index, chat: 'chat', metadata: { action: 'snooze' },
    });
  }
  const chat = await readChatState(db, 'u', 'chat');
  const result = await applyChatSnoozeAction(db, {
    userId: 'u', id: 'chat', status: 'waiting', previousDeadline: null,
    now: NOW, resume: false, stateToken: chat.state_token,
  });
  assert.deepEqual(result, { ok: true, snoozeCount: 3, archiveSuggested: true });
  assert.equal(await readChatSnoozeCount(db, 'u', 'chat'), 3);
});

void test('failed or resume actions never invent an archive suggestion', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { status: 'waiting' });
  const chat = await readChatState(db, 'u', 'chat');
  const first = await applyChatSnoozeAction(db, {
    userId: 'u', id: 'chat', status: 'waiting', previousDeadline: null,
    now: NOW, resume: false, stateToken: chat.state_token,
  });
  assert.deepEqual(first, { ok: true, snoozeCount: 1, archiveSuggested: false });

  const stale = await applyChatSnoozeAction(db, {
    userId: 'u', id: 'chat', status: 'waiting', previousDeadline: null,
    now: NOW, resume: false, stateToken: chat.state_token,
  });
  assert.deepEqual(stale, { ok: false });

  const snoozed = await readChatState(db, 'u', 'chat');
  const resumed = await applyChatSnoozeAction(db, {
    userId: 'u', id: 'chat', status: 'waiting', previousDeadline: snoozed.snoozed_until,
    now: NOW + 1, resume: true, stateToken: snoozed.state_token,
  });
  assert.deepEqual(resumed, { ok: true, snoozeCount: 0, archiveSuggested: false });
  assert.equal(await readChatSnoozeCount(db, 'u', 'chat'), 1);
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
