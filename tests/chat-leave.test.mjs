import assert from 'node:assert/strict';
import test from 'node:test';
import { changeChatLeave } from '../lib/chats/leave.ts';
import { readChatState } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;

async function account(db) {
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'A',1,1,1,1)`).run();
}
async function state(db) { return readChatState(db,'u','chat'); }

void test('archived joined Telegram chat has a recoverable leave checklist state', async t=>{
  const db=await localDatabase(t);await account(db);
  await seedChat(db,{id:'chat',owner:'u',platform:'telegram',status:'ready',joined:NOW-100,updated:NOW-100});
  await db.prepare(`UPDATE chats SET telegram_account_id='a' WHERE id='chat'`).run();
  assert.equal((await transitionChat(db,{userId:'u',chat:await state(db),action:'archive',accountId:'a',now:NOW,reason:'Не актуальний'})).ok,true);
  const archived=await state(db);
  assert.equal(archived.workflow_status,'archived');
  assert.equal(archived.left_at,null);

  const stale=archived;
  assert.equal((await changeChatLeave(db,{userId:'u',chat:archived,now:NOW+1,confirm:true})).ok,true);
  const left=await state(db);
  assert.equal(left.left_at,NOW+1);
  assert.notEqual(left.state_token,archived.state_token);
  assert.equal((await changeChatLeave(db,{userId:'u',chat:stale,now:NOW+2,confirm:true})).ok,false);
  assert.equal((await changeChatLeave(db,{userId:'u',chat:left,now:NOW+2,confirm:false})).ok,true);
  assert.equal((await state(db)).left_at,null);
});

void test('confirmed leave survives restore until the chat is joined again', async t=>{
  const db=await localDatabase(t);await account(db);
  await seedChat(db,{id:'chat',owner:'u',platform:'telegram',status:'ready',joined:NOW-100,updated:NOW-100});
  await db.prepare(`UPDATE chats SET telegram_account_id='a' WHERE id='chat'`).run();
  await transitionChat(db,{userId:'u',chat:await state(db),action:'archive',accountId:'a',now:NOW,reason:'Не актуальний'});
  await changeChatLeave(db,{userId:'u',chat:await state(db),now:NOW+1,confirm:true});
  assert.equal((await transitionChat(db,{userId:'u',chat:await state(db),action:'restore',accountId:'a',now:NOW+2})).ok,true);
  const rejoin=await state(db);
  assert.equal(rejoin.workflow_status,'to_join');
  assert.equal(rejoin.left_at,NOW+1);
  assert.equal((await transitionChat(db,{userId:'u',chat:rejoin,action:'joined',accountId:'a',now:NOW+3})).ok,true);
  assert.equal((await state(db)).left_at,null);
});

void test('archived joined Viber chat uses the same recoverable leave checklist', async t=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'chat',owner:'u',platform:'viber',status:'ready',joined:NOW-100});
  assert.equal((await transitionChat(db,{userId:'u',chat:await state(db),action:'archive',accountId:null,now:NOW,reason:'Чат не цільовий'})).ok,true);
  const archived=await state(db);
  assert.equal((await changeChatLeave(db,{userId:'u',chat:archived,now:NOW+1,confirm:true})).ok,true);
  const left=await state(db);
  assert.equal(left.left_at,NOW+1);
  assert.equal((await changeChatLeave(db,{userId:'u',chat:left,now:NOW+2,confirm:false})).ok,true);
  assert.equal((await state(db)).left_at,null);
});

void test('leave confirmation is rejected outside archived joined checklist platforms', async t=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'chat',owner:'u',platform:'facebook',status:'archived',joined:NOW-100});
  assert.equal((await changeChatLeave(db,{userId:'u',chat:await state(db),now:NOW,confirm:true})).ok,false);
  await db.prepare(`UPDATE chats SET platform='whatsapp',joined_at=NULL WHERE id='chat'`).run();
  assert.equal((await changeChatLeave(db,{userId:'u',chat:await state(db),now:NOW,confirm:true})).ok,false);
});
