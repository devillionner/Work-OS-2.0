import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateNameKey, readChatDuplicateGroups } from '../lib/chats/duplicates.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

void test('duplicate name normalization is case and whitespace stable', () => {
  assert.equal(duplicateNameKey('  МАТУСІ   Київ  '), duplicateNameKey('матусі Київ'));
});

void test('duplicate manager includes active and archived same-name candidates but isolates owners', async (t) => {
  const db=await localDatabase(t);
  await seedChat(db,{id:'one',owner:'u',platform:'whatsapp',status:'ready'});
  await seedChat(db,{id:'two',owner:'u',platform:'whatsapp',status:'archived'});
  await seedChat(db,{id:'foreign',owner:'other',platform:'whatsapp',status:'ready'});
  await db.prepare(`UPDATE chats SET name='МАТУСІ Київ' WHERE id='one'`).run();
  await db.prepare(`UPDATE chats SET name='матусі   Київ',archive_reason='Дублікат' WHERE id='two'`).run();
  await db.prepare(`UPDATE chats SET name='Матусі Київ' WHERE id='foreign'`).run();

  const groups=await readChatDuplicateGroups(db,{userId:'u',platform:'whatsapp'});
  assert.equal(groups.length,1);
  assert.equal(groups[0].kind,'name');
  assert.deepEqual(groups[0].chats.map(chat=>chat.id),['one','two']);
  assert.equal(groups[0].chats[1].archiveReason,'Дублікат');
  assert.ok(groups[0].chats.every(chat=>typeof chat.stateToken==='string'&&chat.stateToken.length>0));
});

void test('telegram duplicate manager is isolated to the selected account', async (t) => {
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'A',1,1,1,1),('b','u',2,'B',1,0,1,1)`).run();
  for(const [id,account] of [['a1','a'],['a2','a'],['b1','b']]) {
    await seedChat(db,{id,owner:'u',platform:'telegram',status:'ready'});
    await db.prepare(`UPDATE chats SET name='Спільна назва',telegram_account_id=?1 WHERE id=?2`).bind(account,id).run();
  }
  const groups=await readChatDuplicateGroups(db,{userId:'u',platform:'telegram',accountId:'a'});
  assert.equal(groups.length,1);
  assert.deepEqual(groups[0].chats.map(chat=>chat.id),['a1','a2']);
});
