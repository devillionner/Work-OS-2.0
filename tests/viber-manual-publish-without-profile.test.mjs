import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { recordManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const DATE='2026-09-29';
const NOW=Date.parse('2026-09-29T16:00:00Z')/1000;

void test('Viber manual publication does not require a confirmed chat profile',async t=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'viber-ready',owner:'u',platform:'viber',status:'ready'});
  const chat=await readChatState(db,'u','viber-ready');
  assert.ok(chat);
  const result=await recordManualPublication(db,{
    userId:'u',chat,accountId:null,advertisementId:null,language:null,
    now:NOW,date:DATE,stateToken:chat.state_token,
  });
  assert.equal(result.ok,true);
  assert.equal(Number(await db.prepare("SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id='viber-ready'").first('COUNT(*)')),1);
});

// Operator decision 2026-10-02: WhatsApp publishes like Viber, without a confirmed profile.
void test('WhatsApp manual publication does not require a confirmed chat profile',async t=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'wa-ready',owner:'u',platform:'whatsapp',status:'ready'});
  const chat=await readChatState(db,'u','wa-ready');
  assert.ok(chat);
  const result=await recordManualPublication(db,{
    userId:'u',chat,accountId:null,advertisementId:null,language:null,
    now:NOW,date:DATE,stateToken:chat.state_token,
  });
  assert.equal(result.ok,true);
  assert.equal(Number(await db.prepare("SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id='wa-ready'").first('COUNT(*)')),1);
});

// Operator decision 2026-10-06: Telegram publishes without a confirmed profile too. The profile rules are
// still being written, and the gate only blocked the manual publishing it was meant to support.
void test('Telegram manual publication does not require a confirmed chat profile either',async t=>{
  const db=await localDatabase(t);
  // A Telegram publication is still attributed to an enabled account — that requirement is untouched.
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('acc','u',1,'Основа',1,1,1,1)`).run();
  await seedChat(db,{id:'tg-ready',owner:'u',platform:'telegram',status:'ready'});
  const chat=await readChatState(db,'u','tg-ready');
  assert.ok(chat);
  const result=await recordManualPublication(db,{
    userId:'u',chat,accountId:'acc',advertisementId:null,language:null,
    now:NOW,date:DATE,stateToken:chat.state_token,
  });
  assert.equal(result.ok,true,'error' in result?result.error:'');
  assert.equal(Number(await db.prepare("SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id='tg-ready'").first('COUNT(*)')),1);
});
