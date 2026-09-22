import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';
import { readChatState, chatStateTokenSql } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import { changeChatSnooze } from '../lib/chats/snooze.ts';
import { recordManualPublication, undoManualPublication } from '../lib/chats/publication.ts';
import { activitySummaryStatement, activityTotals } from '../lib/activity-summary.ts';
import { joinedTodayStatement } from '../lib/chats/daily-links.ts';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;
const state = db => readChatState(db,'u','chat');
const transition = (db,chat,action,extra={}) => transitionChat(db,{userId:'u',chat,action,accountId:null,now:NOW,...extra});
const count = async (db,type) => (await db.prepare('SELECT COUNT(*) n FROM activity_events WHERE event_type=?1').bind(type).first()).n;
async function accounts(db) {
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'One',1,1,1,1),('b','u',2,'Two',1,0,1,1),('disabled','u',3,'Disabled',0,0,1,1),('foreign','other',1,'Foreign',1,1,1,1)`).run();
}
async function seed(db,platform='telegram',status='to_join') {
  await seedChat(db,{platform,status});
  await db.prepare("UPDATE chats SET updated_at=?1 WHERE id='chat'").bind(NOW).run();
  return state(db);
}

void test('concurrent join delivery creates one transition, one daily metric and one account increment', async t => {
  const db=await localDatabase(t); await accounts(db);
  const before=await seed(db);
  const results=await Promise.all([transition(db,before,'joined',{accountId:'a'}),transition(db,before,'joined',{accountId:'a'})]);
  assert.equal(results.filter(r=>r.ok).length,1);
  const after=await state(db);
  assert.equal(after.workflow_status,'ready'); assert.equal(after.joined_at,NOW); assert.equal(after.telegram_account_id,'a');
  assert.equal(await count(db,'chat_state_changed'),1); assert.equal(await count(db,'chat_joined'),1);
  assert.equal((await db.prepare("SELECT join_streak FROM telegram_accounts WHERE id='a'").first()).join_streak,1);
  assert.equal((await transition(db,after,'joined',{accountId:'a'})).ok,false);
});

void test('waiting and approval count once, bind the account and start the six-hour wait at approval', async t => {
  const db=await localDatabase(t); await accounts(db); await seed(db);
  assert.equal((await transition(db,await state(db),'waiting',{accountId:'a'})).ok,true);
  assert.equal(await count(db,'chat_joined'),0);
  // An old imported date on a waiting request is not its new approval time.
  await db.prepare("UPDATE chats SET joined_at=1 WHERE id='chat'").run();
  await db.prepare("UPDATE telegram_accounts SET join_streak=9,break_until=?1 WHERE id='a'").bind(NOW-1).run();
  const waiting=await state(db);
  const results=await Promise.all([transition(db,waiting,'approved',{accountId:'a'}),transition(db,waiting,'approved',{accountId:'a'})]);
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal((await state(db)).joined_at,NOW);
  assert.equal(await count(db,'chat_joined'),1);
  assert.equal((await db.prepare("SELECT join_streak FROM telegram_accounts WHERE id='a'").first()).join_streak,1);
});

void test('join versus archive race has one winner; archive, restore and same-day rejoin preserve metrics', async t => {
  const db=await localDatabase(t); await accounts(db); const before=await seed(db);
  const results=await Promise.all([transition(db,before,'joined',{accountId:'a'}),transition(db,before,'archive',{accountId:'a',reason:'Чат не цільовий'})]);
  assert.equal(results.filter(r=>r.ok).length,1);
  const current=await state(db);
  if(current.workflow_status==='ready') assert.equal((await transition(db,current,'archive',{reason:'Чат не цільовий'})).ok,true);
  const archived=await state(db);
  assert.equal(archived.telegram_account_id,'a');
  assert.equal((await db.prepare("SELECT archive_reason FROM chats WHERE id='chat'").first()).archive_reason,'Чат не цільовий');
  assert.equal((await transition(db,archived,'restore')).ok,true);
  const restored=await db.prepare("SELECT * FROM chats WHERE id='chat'").first();
  for(const key of ['joined_at','processed_at','snoozed_until','archive_reason','archived_at','telegram_account_id']) assert.equal(restored[key],null,key);
  assert.equal((await transition(db,await state(db),'joined',{accountId:'a'})).ok,true);
  assert.equal(await count(db,'chat_joined'),1);
  assert.equal((await db.prepare("SELECT join_streak FROM telegram_accounts WHERE id='a'").first()).join_streak,1);
  const summary=await activitySummaryStatement(db,'u','2026-09-10','2026-09-10').all();
  assert.equal(activityTotals(summary.results).joined,1);
});

void test('state token rejects an old action after same-second archive/restore and snooze/resume cycles', async t => {
  const db=await localDatabase(t); const old=await seed(db,'whatsapp');
  assert.equal((await transition(db,old,'archive')).ok,true);
  assert.equal((await transition(db,await state(db),'restore')).ok,true);
  assert.equal((await state(db)).workflow_status,old.workflow_status);
  assert.notEqual((await state(db)).state_token,old.state_token);
  assert.equal((await transition(db,old,'joined')).ok,false);
  assert.equal((await transition(db,await state(db),'joined')).ok,true);
  const ready=await state(db);
  const snooze={userId:'u',id:'chat',status:'ready',previousDeadline:null,now:NOW,resume:false,stateToken:ready.state_token};
  assert.equal(await changeChatSnooze(db,snooze),true);
  const snoozed=await state(db);
  assert.equal(await changeChatSnooze(db,{...snooze,resume:true,previousDeadline:snoozed.snoozed_until,stateToken:snoozed.state_token}),true);
  assert.equal((await transition(db,ready,'archive')).ok,false);
  assert.equal(await changeChatSnooze(db,snooze),false);
});

void test('account reassignment rejects stale or disabled targets and preserves archive details', async t => {
  const db=await localDatabase(t); await accounts(db); await seed(db);
  await transition(db,await state(db),'waiting',{accountId:'a'});
  const waiting=await state(db);
  for(const accountId of ['foreign','disabled','missing']) assert.equal((await transition(db,waiting,'assign_account',{accountId})).ok,false);
  assert.equal((await transition(db,waiting,'assign_account',{accountId:'b'})).ok,true);
  assert.equal((await transition(db,waiting,'approved',{accountId:'a'})).ok,false);
  assert.equal((await transition(db,await state(db),'approved',{accountId:'b'})).ok,true);
  assert.equal((await db.prepare("SELECT telegram_account_id FROM activity_events WHERE event_type='chat_joined'").first()).telegram_account_id,'b');
  await transition(db,await state(db),'archive',{reason:'Забанено'});
  await transition(db,await state(db),'assign_account',{accountId:'a'});
  const archived=await db.prepare("SELECT * FROM chats WHERE id='chat'").first();
  assert.equal(archived.workflow_status,'archived'); assert.equal(archived.archive_reason,'Забанено'); assert.equal(archived.archived_at,NOW);
  assert.equal(archived.telegram_account_id,'a');
});

void test('every transition rechecks ownership; disabled Telegram accounts cannot join or publish', async t => {
  const db=await localDatabase(t); await accounts(db); const before=await seed(db);
  assert.equal((await transition(db,before,'joined',{userId:'other',accountId:'foreign'})).ok,false);
  for(const accountId of [null,'foreign','disabled']) assert.equal((await transition(db,before,'joined',{accountId})).ok,false);
  await db.prepare("UPDATE telegram_accounts SET is_enabled=0 WHERE id='a'").run();
  assert.equal((await transition(db,before,'joined',{accountId:'a'})).ok,false);
  await db.prepare("UPDATE chats SET workflow_status='ready',joined_at=1,telegram_account_id='a' WHERE id='chat'").run();
  const ready=await state(db);
  assert.equal((await recordManualPublication(db,{userId:'u',chat:ready,accountId:'a',now:NOW,date:'2026-09-10',stateToken:ready.state_token})).ok,false);
  assert.equal(await count(db,'chat_joined'),0); assert.equal(await count(db,'publication'),0);
});

void test('history and metrics roll back with a failed metric or account write', async t => {
  const db=await localDatabase(t); await accounts(db); const before=await seed(db);
  for(const [table,when] of [['activity_events',"WHEN NEW.event_type='chat_state_changed'"],['activity_events',"WHEN NEW.event_type='chat_joined'"],['telegram_accounts','']]) {
    const operation=table==='activity_events'?'INSERT':'UPDATE';
    await db.prepare(`CREATE TRIGGER fail_chat_write BEFORE ${operation} ON ${table} ${when} BEGIN SELECT RAISE(ABORT,'injected failure'); END`).run();
    await assert.rejects(transition(db,before,'joined',{accountId:'a'}),/injected failure/);
    assert.deepEqual(await state(db),before);
    assert.equal(await count(db,'chat_state_changed'),0); assert.equal(await count(db,'chat_joined'),0);
    await db.prepare('DROP TRIGGER fail_chat_write').run();
  }
});

void test('WhatsApp return and failed joins preserve history; platform restrictions reject invalid actions', async t => {
  const db=await localDatabase(t); await seed(db,'whatsapp');
  await transition(db,await state(db),'joined');
  assert.equal((await transition(db,await state(db),'return_to_join')).ok,true);
  assert.equal((await transition(db,await state(db),'failed')).ok,true);
  assert.equal((await state(db)).workflow_status,'archived');
  assert.equal(await count(db,'chat_joined'),1);
  await transition(db,await state(db),'restore');
  await db.prepare("UPDATE chats SET platform='viber' WHERE id='chat'").run();
  assert.equal((await transition(db,await state(db),'waiting')).ok,false);
  await transition(db,await state(db),'joined');
  assert.equal((await transition(db,await state(db),'return_to_join')).ok,false);
});

void test('state reads use the chat event index and never write or change their token', async t => {
  const db=await localDatabase(t); await seed(db,'whatsapp');
  await transition(db,await state(db),'joined');
  const before=await state(db);
  const revision=await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first();
  assert.deepEqual(await state(db),before);
  assert.deepEqual(await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first(),revision);
  const plan=await db.prepare(`EXPLAIN QUERY PLAN SELECT ${chatStateTokenSql()} FROM chats c WHERE c.id='chat' AND c.user_id='u'`).all();
  assert.ok(plan.results.some(row=>row.detail.includes('activity_events_chat_type_idx')));
  assert.ok(!plan.results.some(row=>row.detail.includes('USE TEMP B-TREE')));
});

void test('publication requires the displayed version and invalidates it even in the same second', async t => {
  const db=await localDatabase(t); const old=await seed(db,'whatsapp','ready');
  await transition(db,old,'archive');
  await transition(db,await state(db),'restore');
  await transition(db,await state(db),'joined');
  const publish=chat=>recordManualPublication(db,{userId:'u',chat,accountId:null,now:NOW,date:'2026-09-10',stateToken:chat.state_token});
  assert.equal((await publish(old)).ok,false);
  const current=await state(db);
  assert.equal((await publish(current)).ok,true);
  assert.notEqual((await state(db)).state_token,current.state_token);
  assert.equal((await transition(db,current,'archive')).ok,false);
  assert.equal(await count(db,'publication'),1);
});

void test('same-day legacy joins stay unique and daily links survive restore and account reassignment', async t => {
  const db=await localDatabase(t); await accounts(db); await seed(db);
  await seedEvent(db,{id:'legacy-join',type:'chat_joined',chat:'chat',date:'2026-09-10',at:NOW-30});
  await db.prepare("UPDATE activity_events SET telegram_account_id='a' WHERE id='legacy-join'").run();
  assert.equal((await transition(db,await state(db),'joined',{accountId:'a'})).ok,true);
  assert.equal(await count(db,'chat_joined'),1);
  await transition(db,await state(db),'archive');
  await transition(db,await state(db),'assign_account',{accountId:'b'});
  const links=accountId=>joinedTodayStatement(db,{userId:'u',platform:'telegram',date:'2026-09-10',accountId}).all();
  assert.equal((await links('a')).results.length,1); assert.equal((await links('b')).results.length,0);
  await transition(db,await state(db),'restore');
  assert.equal((await links('a')).results.length,1);
  assert.equal((await joinedTodayStatement(db,{userId:'other',platform:'telegram',date:'2026-09-10',accountId:'a'}).all()).results.length,0);
  assert.equal((await joinedTodayStatement(db,{userId:'u',platform:'telegram',date:'2026-09-09',accountId:'a'}).all()).results.length,0);
});


void test('same-day publication undo restores publication facts, profile cadence and Telegram slot', async t => {
  const db=await localDatabase(t); await accounts(db); await seed(db,'telegram','ready');
  await db.prepare("UPDATE chats SET joined_at=1,telegram_account_id='a' WHERE id='chat'").run();
  await db.prepare(`INSERT INTO chat_profiles
    (chat_id,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES ('chat','daily','[]',NULL,NULL,'[]','','confirmed','manual',2)`).run();
  await db.prepare(`INSERT INTO telegram_schedule_slots
    (id,user_id,telegram_account_id,sequence,scheduled_at,chat_id,status,completed_at,publication_id,created_at,updated_at,version)
    VALUES ('slot','u','a',1,?1,'chat','pending',NULL,NULL,1,1,0)`).bind(NOW-60).run();

  const before=await state(db);
  const published=await recordManualPublication(db,{userId:'u',chat:before,accountId:'a',now:NOW,date:'2026-09-10',stateToken:before.state_token});
  assert.equal(published.ok,true);
  if(!published.ok)return;
  const afterPublication=await state(db);
  assert.notEqual(afterPublication.state_token,before.state_token);
  assert.equal((await db.prepare("SELECT next_allowed_on FROM chat_profiles WHERE chat_id='chat'").first()).next_allowed_on,'2026-09-11');
  const completedSlot=await db.prepare("SELECT status,completed_at,publication_id FROM telegram_schedule_slots WHERE id='slot'").first();
  assert.equal(completedSlot.status,'completed');
  assert.equal(completedSlot.publication_id,published.publicationId);

  const undone=await undoManualPublication(db,{userId:'u',chat:afterPublication,now:NOW+30,date:'2026-09-10'});
  assert.equal(undone.ok,true);
  const final=await state(db);
  assert.notEqual(final.state_token,afterPublication.state_token);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_publications WHERE user_id='u' AND chat_id='chat' AND published_on='2026-09-10'").first()).n,0);
  const publicationEvent=await db.prepare("SELECT cancelled_at FROM activity_events WHERE user_id='u' AND chat_id='chat' AND event_type='publication' ORDER BY rowid DESC LIMIT 1").first();
  assert.equal(publicationEvent.cancelled_at,NOW+30);
  assert.equal((await db.prepare("SELECT next_allowed_on FROM chat_profiles WHERE chat_id='chat'").first()).next_allowed_on,null);
  const restoredSlot=await db.prepare("SELECT status,completed_at,publication_id FROM telegram_schedule_slots WHERE id='slot'").first();
  assert.equal(restoredSlot.status,'pending');
  assert.equal(restoredSlot.completed_at,null);
  assert.equal(restoredSlot.publication_id,null);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE user_id='u' AND event_type='publication' AND event_date='2026-09-10' AND cancelled_at IS NULL").first()).n,0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE user_id='u' AND chat_id='chat' AND event_type='chat_state_changed' AND json_extract(metadata_json,'$.action')='undo_published'").first()).n,1);

  const republished=await recordManualPublication(db,{userId:'u',chat:final,accountId:'a',now:NOW+31,date:'2026-09-10',stateToken:final.state_token});
  assert.equal(republished.ok,true);
});
