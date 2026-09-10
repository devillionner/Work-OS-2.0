import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate, businessDayStart, shiftBusinessDate, snoozeDeadline } from '../lib/business-time.ts';
import { publicationAvailability, recordManualPublication } from '../lib/chats/publication.ts';
import { changeChatSnooze } from '../lib/chats/snooze.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const epoch = value => Date.parse(value) / 1000;
const NOW = epoch('2026-09-10T12:00:00Z');
const publish = (db, chat, now = NOW, userId = 'u') => recordManualPublication(db, { userId, chat, accountId: null, now, date: businessDate(now) });

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
  const input = {userId:'u',id:'chat',status:'waiting',previousDeadline:null,now:NOW,resume:false};
  assert.equal(await changeChatSnooze(db,input), true);
  const row = await db.prepare("SELECT * FROM chats WHERE id='chat'").first();
  assert.equal(row.snoozed_until,snoozeDeadline(NOW));
  assert.equal(await changeChatSnooze(db,input), false);
  assert.equal(await changeChatSnooze(db,{...input,previousDeadline:row.snoozed_until,resume:true}), true);
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

void test('publication and event roll back together if the event write fails', async t => {
  const db = await localDatabase(t);
  const chat = await seedChat(db);
  await db.prepare("CREATE TRIGGER fail_publication_event BEFORE INSERT ON activity_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END").run();
  await assert.rejects(publish(db,chat),/injected event failure/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_publications').first()).n,0);
  assert.equal((await db.prepare("SELECT updated_at FROM chats WHERE id='chat'").first()).updated_at,1);
});
