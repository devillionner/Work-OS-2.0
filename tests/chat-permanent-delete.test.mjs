import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { changeChatLeave } from '../lib/chats/leave.ts';
import { permanentlyDeleteChat } from '../lib/chats/permanent-delete.ts';
import { readChatState, chatStateTokenSql } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';

const NOW=Date.parse('2026-09-20T08:00:00Z')/1000;
const state=db=>readChatState(db,'u','chat');

async function archived(db,{platform='viber',joined=false,reason='Чат не існує'}={}) {
  await seedChat(db,{platform,status:joined?'ready':'to_join'});
  if(joined) await db.prepare("UPDATE chats SET joined_at=1 WHERE id='chat'").run();
  await transitionChat(db,{userId:'u',chat:await state(db),action:'archive',accountId:null,now:NOW,reason});
  return state(db);
}

void test('eligible archived chat is deleted once and leaves an immutable owner-scoped audit event',async t=>{
  const db=await localDatabase(t); const chat=await archived(db);
  const [first,second]=await Promise.all([
    permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+1}),
    permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+1}),
  ]);
  assert.equal([first,second].filter(result=>result.ok).length,1);
  assert.equal(await state(db),null);
  const audit=await db.prepare("SELECT user_id,event_type,platform,chat_id,metadata_json FROM activity_events WHERE event_type='chat_permanently_deleted'").first();
  assert.equal(audit.user_id,'u'); assert.equal(audit.platform,'viber'); assert.equal(audit.chat_id,null);
  assert.deepEqual(JSON.parse(audit.metadata_json),{
    action:'permanent_delete',deletedChatId:'chat',name:'chat',link:'https://example.test/chat',archiveReason:'Чат не існує',archivedAt:NOW,
    previousState:JSON.parse(chat.state_token),
  });
  const prior=await db.prepare("SELECT COUNT(*) count FROM activity_events WHERE event_type='chat_state_changed' AND chat_id IS NULL").first('count');
  assert.equal(prior,1);
});

void test('reason, ownership and confirmed-leave policy are rechecked in the domain',async t=>{
  const db=await localDatabase(t); let chat=await archived(db,{platform:'whatsapp',joined:true,reason:'Чат не цільовий'});
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+1})).ok,false);
  await db.prepare("UPDATE chats SET archive_reason='Чат не існує' WHERE id='chat'").run(); chat=await state(db);
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+1})).ok,false);
  assert.equal((await changeChatLeave(db,{userId:'u',chat,now:NOW+1,confirm:true})).ok,true); chat=await state(db);
  assert.equal((await permanentlyDeleteChat(db,{userId:'other',chat,now:NOW+2})).ok,false);
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+2})).ok,true);
});

void test('joined Viber tombstone requires confirmed external leave before deletion',async t=>{
  const db=await localDatabase(t);
  let chat=await archived(db,{platform:'viber',joined:true});
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+1})).ok,false);
  assert.equal((await changeChatLeave(db,{userId:'u',chat,now:NOW+1,confirm:true})).ok,true);
  chat=await state(db);
  assert.equal(chat.left_at,NOW+1);
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat,now:NOW+2})).ok,true);
});

void test('publications, lead attribution and pending Telegram slots preserve the tombstone',async t=>{
  for(const dependency of ['publication','lead','slot']) {
    const db=await localDatabase(t); await archived(db,{platform:dependency==='slot'?'telegram':'viber'});
    if(dependency==='publication') await db.prepare(`INSERT INTO chat_publications(id,user_id,chat_id,published_on,source,source_key,created_at) VALUES('p','u','chat','2026-09-20','manual','p',?1)`).bind(NOW).run();
    if(dependency==='lead') await db.prepare(`INSERT INTO leads(id,user_id,name,platform,source_chat_id,status,created_at,updated_at) VALUES('l','u','Lead','telegram','chat','new',?1,?1)`).bind(NOW).run();
    if(dependency==='slot') {
      await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES('a','u',1,'A',1,1,?1,?1)`).bind(NOW).run();
      await db.prepare("UPDATE chats SET telegram_account_id='a' WHERE id='chat'").run();
      await db.prepare(`INSERT INTO telegram_schedule_slots(id,user_id,telegram_account_id,sequence,scheduled_at,chat_id,status,created_at,updated_at) VALUES('s','u','a',1,?1,'chat','pending',?1,?1)`).bind(NOW).run();
    }
    const current=await state(db);
    assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat:current,now:NOW+1})).ok,false,dependency);
    assert.ok(await state(db),dependency);
    assert.equal(await db.prepare("SELECT COUNT(*) count FROM activity_events WHERE event_type='chat_permanently_deleted'").first('count'),0,dependency);
  }
});

void test('the guarded delete rejects a stale same-second state token',async t=>{
  const db=await localDatabase(t); const stale=await archived(db);
  await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
    VALUES('later','u','chat_state_changed','viber','chat',?1,'2026-09-20','{}','later')`).bind(NOW).run();
  assert.notEqual((await state(db)).state_token,stale.state_token);
  assert.equal((await permanentlyDeleteChat(db,{userId:'u',chat:stale,now:NOW+1})).ok,false);
  const plan=await db.prepare(`EXPLAIN QUERY PLAN SELECT ${chatStateTokenSql('chats')} FROM chats WHERE id='chat'`).all();
  assert.ok(plan.results.some(row=>row.detail.includes('activity_events_chat_type_idx')));
});
