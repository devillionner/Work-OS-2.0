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

void test('WhatsApp normal manual publication still requires a confirmed profile',async t=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'wa-ready',owner:'u',platform:'whatsapp',status:'ready'});
  const chat=await readChatState(db,'u','wa-ready');
  assert.ok(chat);
  const result=await recordManualPublication(db,{
    userId:'u',chat,accountId:null,advertisementId:null,language:null,
    now:NOW,date:DATE,stateToken:chat.state_token,
  });
  assert.equal(result.ok,false);
  assert.match(result.error,/профілю/iu);
});

void test('Viber ready UI exposes publish without profile workflow gates',async()=>{
  const workspace=await readFile(new URL('../components/platform-workspace.tsx',import.meta.url),'utf8');
  const dialog=await readFile(new URL('../components/chat-publish-dialog.tsx',import.meta.url),'utf8');
  assert.match(workspace,/profileBlocksManualPublication\(chat,quickPublishMode\)/);
  assert.match(workspace,/chat\.platform!=='viber'/);
  assert.match(workspace,/chat\.platform==='viber'&&canPublish\(chat,clock\)\)return 'Опублікувати'/);
  assert.match(workspace,/queues\.filter\(item=>platform!=='viber'\|\|item\.key!=='profile_review'\)/);
  assert.match(workspace,/\(queue==='waiting'\|\|queue==='ready'\)\&\&platform!=='viber'/);
  assert.match(dialog,/chat\.platform!=='viber'/);
});
