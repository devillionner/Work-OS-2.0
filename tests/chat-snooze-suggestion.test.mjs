import assert from 'node:assert/strict';
import test from 'node:test';
import { chatSnoozeCountSql, shouldSuggestChatArchive } from '../lib/chats/snooze-history.ts';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';

void test('archive suggestion starts after the third snooze', () => {
  assert.equal(shouldSuggestChatArchive(0), false);
  assert.equal(shouldSuggestChatArchive(2), false);
  assert.equal(shouldSuggestChatArchive(3), true);
  assert.equal(shouldSuggestChatArchive(5), true);
});

void test('snooze count is owner and chat scoped and ignores unsnooze events', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat-u', owner: 'u' });
  await seedChat(db, { id: 'chat-other', owner: 'other' });
  await seedEvent(db, { id: 's1', type: 'chat_state_changed', date: '2026-09-10', chat: 'chat-u', metadata: { action: 'snooze' } });
  await seedEvent(db, { id: 's2', type: 'chat_state_changed', date: '2026-09-11', chat: 'chat-u', metadata: { action: 'snooze' } });
  await seedEvent(db, { id: 'u1', type: 'chat_state_changed', date: '2026-09-11', chat: 'chat-u', metadata: { action: 'unsnooze' } });
  await seedEvent(db, { id: 's3', type: 'chat_state_changed', date: '2026-09-12', chat: 'chat-u', metadata: { action: 'snooze' } });
  await seedEvent(db, { id: 'other-s', owner: 'other', type: 'chat_state_changed', date: '2026-09-12', chat: 'chat-other', metadata: { action: 'snooze' } });

  const row = await db.prepare(`SELECT ${chatSnoozeCountSql()} AS snooze_count FROM chats c WHERE c.id='chat-u' AND c.user_id='u'`).first();
  assert.equal(Number(row.snooze_count), 3);
  assert.equal(shouldSuggestChatArchive(Number(row.snooze_count)), true);
});
