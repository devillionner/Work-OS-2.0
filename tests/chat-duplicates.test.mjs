import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateGroups, readChatDuplicateGroups, renameDuplicateChat } from '../lib/chats/duplicates.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

void test('duplicate grouping keeps same-name different-url chats as manual candidates', () => {
  const base = { platform:'whatsapp', status:'ready', archiveReason:null, archivedAt:null, telegramAccountId:null, stateToken:'x' };
  const groups = duplicateGroups([
    { ...base, id:'a', name:'Мами Київ', link:'https://example.test/a', normalizedLink:'https://example.test/a' },
    { ...base, id:'b', name:'  Мами   Київ ', link:'https://example.test/b', normalizedLink:'https://example.test/b' },
    { ...base, id:'c', name:'Інший чат', link:'https://example.test/c', normalizedLink:'https://example.test/c' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].match, 'name');
  assert.deepEqual(groups[0].chats.map(chat => chat.id), ['a', 'b']);
});

void test('duplicate read is owner/platform scoped and Telegram respects account scope plus unassigned join queue', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'A',1,1,1,1),('b','u',2,'B',1,0,1,1),('other-a','other',1,'Other',1,1,1,1)`).run();
  for (const [id, owner, status, account] of [
    ['a-ready','u','ready','a'], ['a-archive','u','archived','a'], ['b-ready','u','ready','b'],
    ['unassigned','u','to_join',null], ['foreign','other','ready','other-a'],
  ]) {
    await seedChat(db, { id, owner, platform:'telegram', status });
    await db.prepare(`UPDATE chats SET name='Одна назва',telegram_account_id=?1 WHERE id=?2`).bind(account,id).run();
  }
  const groups = await readChatDuplicateGroups(db, { userId:'u', platform:'telegram', accountId:'a' });
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].chats.map(chat => chat.id)), new Set(['a-ready','a-archive','unassigned']));
});

void test('rename is owner-scoped, CAS guarded and appends chat history event', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id:'mine', owner:'u', platform:'whatsapp', status:'ready' });
  await seedChat(db, { id:'foreign', owner:'other', platform:'whatsapp', status:'ready' });
  const before = await readChatState(db,'u','mine');
  const result = await renameDuplicateChat(db,{userId:'u',id:'mine',stateToken:before.state_token,name:'  Нова   назва  ',now:100});
  const row = await db.prepare(`SELECT name FROM chats WHERE id='mine'`).first();
  assert.equal(row.name,'Нова назва');
  assert.notEqual(result.stateToken,before.state_token);
  const event = await db.prepare(`SELECT event_type,metadata_json FROM activity_events WHERE chat_id='mine' AND event_type='chat_state_changed'`).first();
  assert.equal(event.event_type,'chat_state_changed');
  assert.match(String(event.metadata_json),/rename/);
  await assert.rejects(renameDuplicateChat(db,{userId:'u',id:'mine',stateToken:before.state_token,name:'Ще одна',now:101}),/вже змінився/);
  await assert.rejects(renameDuplicateChat(db,{userId:'u',id:'foreign',stateToken:'x',name:'Не можна',now:101}),/не знайдено/);
});
