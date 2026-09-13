import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { readChatState } from '../lib/chats/state.ts';
import { changeChatLeaveConfirmation, readChatLeaveState, archivedChatNeedsLeave } from '../lib/chats/leave-checklist.ts';
import { transitionChat } from '../lib/chats/transitions.ts';

const NOW = Date.parse('2026-09-13T12:00:00Z') / 1000;

void test('only archived joined Telegram and WhatsApp chats require leave confirmation', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'tg', platform: 'telegram', status: 'archived', joined: 100 });
  await seedChat(db, { id: 'wa', platform: 'whatsapp', status: 'archived', joined: 100 });
  await seedChat(db, { id: 'vb', platform: 'viber', status: 'archived', joined: 100 });
  await seedChat(db, { id: 'never-joined', platform: 'telegram', status: 'archived' });
  assert.equal((await readChatLeaveState(db, 'u', 'tg')).required, true);
  assert.equal((await readChatLeaveState(db, 'u', 'wa')).required, true);
  assert.equal((await readChatLeaveState(db, 'u', 'vb')).required, false);
  assert.equal((await readChatLeaveState(db, 'u', 'never-joined')).required, false);
  assert.equal(archivedChatNeedsLeave({ platform: 'telegram', joinedAt: 100, leaveConfirmed: false }), true);
  assert.equal(archivedChatNeedsLeave({ platform: 'telegram', joinedAt: 100, leaveConfirmed: true }), false);
});

void test('leave confirmation and undo are versioned, owner scoped and recoverable', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat', platform: 'whatsapp', status: 'archived', joined: 100 });
  const before = await readChatState(db, 'u', 'chat');
  assert.deepEqual(await readChatLeaveState(db, 'u', 'chat'), { required: true, confirmed: false, confirmedAt: null });

  assert.equal((await changeChatLeaveConfirmation(db, { userId: 'other', chatId: 'chat', stateToken: before.state_token, confirm: true, now: NOW })).ok, false);
  assert.equal((await changeChatLeaveConfirmation(db, { userId: 'u', chatId: 'chat', stateToken: before.state_token, confirm: true, now: NOW })).ok, true);
  const confirmed = await readChatLeaveState(db, 'u', 'chat');
  assert.deepEqual(confirmed, { required: true, confirmed: true, confirmedAt: NOW });

  assert.equal((await changeChatLeaveConfirmation(db, { userId: 'u', chatId: 'chat', stateToken: before.state_token, confirm: true, now: NOW })).ok, false);
  const afterConfirm = await readChatState(db, 'u', 'chat');
  assert.notEqual(afterConfirm.state_token, before.state_token);
  assert.equal((await changeChatLeaveConfirmation(db, { userId: 'u', chatId: 'chat', stateToken: afterConfirm.state_token, confirm: false, now: NOW + 1 })).ok, true);
  assert.deepEqual(await readChatLeaveState(db, 'u', 'chat'), { required: true, confirmed: false, confirmedAt: null });
});

void test('joined Telegram and WhatsApp archive cannot restore before confirmed leave', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat', platform: 'whatsapp', status: 'archived', joined: 100 });
  let chat = await readChatState(db, 'u', 'chat');
  const blocked = await transitionChat(db, { userId: 'u', chat, action: 'restore', accountId: null, now: NOW });
  assert.deepEqual(blocked, { ok: false, error: 'Спочатку підтвердьте, що ви вийшли з архівного чату.' });
  assert.equal((await readChatState(db, 'u', 'chat')).workflow_status, 'archived');

  assert.equal((await changeChatLeaveConfirmation(db, { userId: 'u', chatId: 'chat', stateToken: chat.state_token, confirm: true, now: NOW })).ok, true);
  chat = await readChatState(db, 'u', 'chat');
  assert.equal((await transitionChat(db, { userId: 'u', chat, action: 'restore', accountId: null, now: NOW + 1 })).ok, true);
  const restored = await readChatState(db, 'u', 'chat');
  assert.equal(restored.workflow_status, 'to_join');
  assert.equal(restored.joined_at, null);
  assert.deepEqual(await readChatLeaveState(db, 'u', 'chat'), { required: false, confirmed: false, confirmedAt: null });
});

void test('active, non-joined and non-supported chats cannot forge leave confirmation', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'active', platform: 'telegram', status: 'ready', joined: 100 });
  await seedChat(db, { id: 'not-joined', platform: 'whatsapp', status: 'archived' });
  await seedChat(db, { id: 'facebook', platform: 'facebook', status: 'archived', joined: 100 });
  for (const id of ['active', 'not-joined', 'facebook']) {
    const state = await readChatState(db, 'u', id);
    assert.equal((await changeChatLeaveConfirmation(db, { userId: 'u', chatId: id, stateToken: state.state_token, confirm: true, now: NOW })).ok, false);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE event_type='chat_leave_confirmed'").first()).n, 0);
});
