import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';
import { readChatHistory } from '../lib/chats/history.ts';

void test('chat history is newest first, bounded and read-only', async t => {
  const db = await localDatabase(t); await seedChat(db, { platform:'telegram', status:'ready' });
  await seedEvent(db, { id:'old', type:'chat_state_changed', chat:'chat', date:'2026-09-09', at:10 });
  await seedEvent(db, { id:'new', type:'chat_profile_changed', chat:'chat', date:'2026-09-11', at:20 });
  const before = await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first();
  assert.deepEqual((await readChatHistory(db,'u','chat')).map(item=>item.id), ['new','old']);
  assert.deepEqual(await readChatHistory(db,'u','chat',1).then(items=>items.map(item=>item.id)), ['new']);
  assert.deepEqual(await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first(), before);
});

void test('chat history cannot cross owners or expose an unknown chat', async t => {
  const db = await localDatabase(t); await seedChat(db, { platform:'whatsapp', status:'ready' });
  await seedChat(db, { id:'other-chat', owner:'other', platform:'whatsapp', status:'ready' });
  assert.deepEqual(await readChatHistory(db,'other','chat'), []);
  assert.deepEqual(await readChatHistory(db,'u','other-chat'), []);
  assert.deepEqual(await readChatHistory(db,'u','missing'), []);
});
