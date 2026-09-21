import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate, businessDayStart, shiftBusinessDate, snoozeDeadline } from '../lib/business-time.ts';
import { publicationAvailability, recordManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';
import { changeChatSnooze } from '../lib/chats/snooze.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { availableTodayStatement } from '../lib/chats/daily-links.ts';

const epoch = value => Date.parse(value) / 1000;
const NOW = epoch('2026-09-10T12:00:00Z');
const publish = (db, chat, now = NOW, userId = 'u') => recordManualPublication(db, { userId, chat, accountId: null, now, date: businessDate(now), stateToken:chat.state_token });

void test('three calendar days end at Kyiv midnight across DST, leap day and year change', () => {
  for (const [now, expected] of [
    ['2026-09-10T20:59:59Z','2026-09-12T21:00:00Z'],
    ['2026-09-10T21:00:00Z','2026-09-13T21:00:00Z'],
    ['2026-03-28T20:00:00Z','2026-03-30T21:00:00Z'],
    ['2026-10-24T20:00:00Z','2026-10-26T22:00:00Z'],
    ['2026-12-30T20:00:00Z','2027-01-01T22:00:00Z'],
    ['2028-02-28T20:00:00Z','2028-03-01T22:00:00Z'],
  ]) assert.equal(snoozeDeadline(epoch(now)), epoch(expected));
  assert.equal(businessDayStart('2026-03-30') - businessDayStart('2026-03-29'), 23 * 3600);
  assert.equal(businessDayStart('2026-10-26') - businessDayStart('2026-10-25'), 25 * 3600);
  assert.equal(shiftBusinessDate('2028-02-28',3), '2028-03-02');
});

void test('publication eligibility uses the later deadline and requires a ready chat', () => {
  const chat = { id:'x',platform:'telegram',workflow_status:'ready',joined_at:0,snoozed_until:23000 };
  assert.deepEqual(publicationAvailability(chat,22999), {availableAt:23000,availableNow:false});
  assert.equal(publicationAvailability(chat,23000).availableNow, true);
  assert.equal(publicationAvailability({...chat,snoozed_until:null},21599).availableNow, false);
  assert.equal(publicationAvailability({...chat,snoozed_until:null},21600).availableNow, true);
  assert.equal(publicationAvailability({...chat,workflow_status:'waiting'},50000).availableNow, false);
  assert.equal(publicationAvailability({...chat,platform:'viber',snoozed_until:null},1).availableNow, true);
});

void test('snooze and resume persist without losing history; stale snooze cannot unarchive a chat', async t => {
  const db = await localDatabase(t);
  await seedChat(db, {status:'waiting'});
  const input = {userId:'u',id:'chat',status:'waiting',previousDeadline:null,now:NOW,resume:false,stateToken:(await readChatState(db,'u','chat')).state_token};
  assert.equal(await changeChatSnooze(db,input), true);
  const row = await db.prepare("SELECT * FROM chats WHERE id='chat'").first();
  assert.equal(row.snoozed_until,snoozeDeadline(NOW));
  assert.equal(await changeChatSnooze(db,input), false);
  assert.equal(await changeChatSnooze(db,{...input,previousDeadline:row.snoozed_until,resume:true,stateToken:(await readChatState(db,'u','chat')).state_token}), true);
  await db.prepare("UPDATE chats SET workflow_status='archived' WHERE id='chat'").run();
  assert.equal(await changeChatSnooze(db,input), false);
  assert.equal((await db.prepare("SELECT workflow_status FROM chats WHERE id='chat'").first()).workflow_status,'archived');
  assert.equal(await changeChatSnooze(db,{...input,userId:'other'}), false);
});

void test('publication is blocked during snooze and concurrent retries record exactly one event', async t => {
  const db = await localDatabase(t);
  const deadline = snoozeDeadline(NOW);
  const chat = await seedChat(db,{snoozed:deadline});
  assert.equal((await publish(db,chat,deadline-1)).ok,false);
  const results = await Promise.all([publish(db,chat,deadline),publish(db,chat,deadline)]);
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal((await publish(db,chat,deadline)).ok,false);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_publications').first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE event_type='publication'").first()).n,1);
});

void test('transaction rechecks archive, snooze, six-hour limit and owner after an earlier read', async t => {
  const db = await localDatabase(t);
  const chat = await seedChat(db);
  for (const change of ["workflow_status='archived'",`snoozed_until=${NOW+1}`,`platform='telegram',joined_at=${NOW}`]) {
    await db.prepare(`UPDATE chats SET ${change} WHERE id='chat'`).run();
    assert.equal((await publish(db,chat)).ok,false);
    await db.prepare("UPDATE chats SET workflow_status='ready',snoozed_until=NULL,platform='whatsapp',joined_at=NULL WHERE id='chat'").run();
  }
  assert.equal((await publish(db,chat,NOW,'other')).ok,false);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_publications').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM activity_events').first()).n,0);
});

void test('unqualified discovery chats are excluded from posting until target is confirmed', async t => {
  const db = await localDatabase(t);
  const chat = await seedChat(db,{id:'discovered-chat',platform:'whatsapp',status:'ready'});
  await db.prepare(`INSERT INTO chat_discovery_candidates
    (id,user_id,platform,link,normalized_link,discovered_at,decision,imported_chat_id,created_at,updated_at)
    VALUES ('candidate','u','whatsapp','https://chat.whatsapp.com/Discovery123','https://chat.whatsapp.com/Discovery123',1,'review','discovered-chat',1,1)`).run();

  const blocked = await publish(db,chat);
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/кваліфікацію/u);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_publications').first()).n,0);
  const blockedLinks=(await availableTodayStatement(db,{userId:'u',platform:'whatsapp',date:'2026-09-10',accountId:null,now:NOW}).all()).results;
  assert.equal(blockedLinks.some(row=>row.name===chat.name),false);

  await db.prepare("UPDATE chat_discovery_candidates SET decision='target',updated_at=2 WHERE id='candidate'").run();
  const availableLinks=(await availableTodayStatement(db,{userId:'u',platform:'whatsapp',date:'2026-09-10',accountId:null,now:NOW}).all()).results;
  assert.equal(availableLinks.some(row=>row.name===chat.name),true);
  assert.equal((await publish(db,chat)).ok,true);
});

void test('publication and event roll back together if the event write fails', async t => {
  const db = await localDatabase(t);
  const chat = await seedChat(db);
  await db.prepare("CREATE TRIGGER fail_publication_event BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END").run();
  await assert.rejects(publish(db,chat),/injected event failure/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_publications').first()).n,0);
  assert.equal((await db.prepare("SELECT updated_at FROM chats WHERE id='chat'").first()).updated_at,1);
});

void test('manual publication attributes one active owner-scoped advertisement atomically', async t => {
  const db = await localDatabase(t); const chat = await seedChat(db);
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,title,uk_text,created_at,updated_at)
    VALUES ('ad','u','advertisement','Англійська для дітей','Текст','1','1'),('foreign-ad','other','advertisement','Чуже','Чуже','1','1'),('script','u','script','Скрипт','Відповідь','1','1')`).run();
  assert.equal((await publishWithAd(db,chat,'ad','ru')).ok,true);
  assert.equal((await db.prepare("SELECT advertisement_id FROM chat_publications WHERE chat_id='chat'").first()).advertisement_id,'ad');
  assert.deepEqual(JSON.parse((await db.prepare("SELECT metadata_json FROM activity_events WHERE event_type='publication'").first()).metadata_json),{advertisementId:'ad',language:'ru'});
  const second = await seedChat(db,{id:'second-chat'});
  assert.equal((await publishWithAd(db,second,'foreign-ad')).ok,false);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_publications WHERE chat_id='second-chat'").first()).n,0);
  await db.prepare("UPDATE library_items SET archived_at=2 WHERE id='ad'").run();
  const third = await seedChat(db,{id:'third-chat'});
  assert.equal((await publishWithAd(db,third,'ad')).ok,false);
});

void test('quick publish may reuse one active material across WhatsApp chats without weakening normal reuse rules', async t => {
  const db = await localDatabase(t);
  const first = await seedChat(db,{id:'quick-first',platform:'whatsapp',status:'ready'});
  const second = await seedChat(db,{id:'quick-second',platform:'whatsapp',status:'ready'});
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,title,uk_text,created_at,updated_at)
    VALUES ('quick-ad','u','advertisement','Швидке оголошення','Текст','1','1'),('unused-ad','u','advertisement','Інше оголошення','Інший текст','1','2')`).run();
  assert.equal((await publishWithAd(db,first,'quick-ad','uk')).ok,true);
  assert.equal((await publishWithAd(db,second,'quick-ad','uk')).ok,false);
  assert.equal((await publishWithAd(db,second,'quick-ad','uk',true)).ok,true);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_publications WHERE advertisement_id='quick-ad'").first()).n,2);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE event_type='publication' AND json_extract(metadata_json,'$.advertisementId')='quick-ad'").first()).n,2);
  const telegram = await seedChat(db,{id:'quick-telegram',platform:'telegram',status:'ready'});
  assert.equal((await publishWithAd(db,telegram,'quick-ad','uk',true)).ok,false);
});

void test('available publication links exclude published, snoozed and foreign Telegram chats', async t => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'One',1,1,1,1),('b','u',2,'Two',1,0,1,1)`).run();
  await seedChat(db,{id:'ready-a',platform:'telegram',status:'ready'});
  await seedChat(db,{id:'ready-b',platform:'telegram',status:'ready'});
  await seedChat(db,{id:'snoozed',platform:'telegram',status:'ready',snoozed:NOW+60});
  await seedChat(db,{id:'published',platform:'telegram',status:'ready'});
  await seedChat(db,{id:'foreign-ready',owner:'other',platform:'telegram',status:'ready'});
  await db.prepare(`UPDATE chats SET telegram_account_id='a',joined_at=?1 WHERE id IN ('ready-a','published','snoozed')`).bind(NOW-21600).run();
  await db.prepare("UPDATE chats SET telegram_account_id='b',joined_at=?1 WHERE id='ready-b'").bind(NOW-21600).run();
  await db.prepare("INSERT INTO chat_publications(id,user_id,chat_id,published_on,source_key,created_at) VALUES ('pub','u','published','2026-09-10','legacy:pub',1)").run();
  const links=(await availableTodayStatement(db,{userId:'u',platform:'telegram',date:'2026-09-10',accountId:'a',now:NOW}).all()).results;
  assert.deepEqual(links.map(row=>row.name),['ready-a']);
});

const publishWithAd = (db, chat, advertisementId, language = null, quickMode = false) => recordManualPublication(db, { userId:'u', chat, accountId:null, advertisementId, language, quickMode, now:NOW, date:'2026-09-10', stateToken:chat.state_token });
