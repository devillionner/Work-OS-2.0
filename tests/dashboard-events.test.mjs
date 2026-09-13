import assert from 'node:assert/strict';
import test from 'node:test';
import { readDashboardSnapshot } from '../lib/dashboard-data.ts';
import { activitySummaryStatement, activityTotals } from '../lib/activity-summary.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;
const TODAY = '2026-09-10';

async function report(db, submittedAt = NOW - 10, text = 'Telegram\nВідгуки: 999\nЗаписи: 999\nЦіль по записам на день: 999/999') {
  await db.prepare(`INSERT INTO daily_reports(id,user_id,report_date,report_text,payload_json,submitted_at,updated_at)
    VALUES ('report','u',?1,?2,'{}',?3,?3)
    ON CONFLICT(user_id,report_date) DO UPDATE SET report_text=excluded.report_text,submitted_at=excluded.submitted_at`)
    .bind(TODAY,text,submittedAt).run();
}

void test('Today uses event dates, counts repeat bookings and Threads, and ignores report text or repeated reads', async t => {
  const db = await localDatabase(t);
  const events = [
    ['response','lead_created','telegram',null],
    ['booking','lesson_booked','telegram',null],
    ['repeat','lesson_booked','telegram',null],
    ['reschedule','lesson_rescheduled','telegram',null],
    ['pending','curator_booking_pending','telegram',null],
    ['resolved-pending','curator_booking_pending','telegram',NOW-20],
    ['thread-response','lead_created','threads',null],
    ['thread-booking','lesson_booked','threads',null],
    ['hidden-booking','lesson_booked','whatsapp',null],
    ['cancelled-response','lead_created','telegram',NOW-20],
  ];
  for (const [id,type,platform,cancelled] of events) await seedEvent(db,{id,type,platform,cancelled,date:TODAY,at:NOW-100});
  // Technical timestamps cannot pull a historical business event into Today.
  await seedEvent(db,{id:'historical',type:'lesson_booked',date:'2026-09-09',at:NOW});
  await seedEvent(db,{id:'foreign',owner:'other',type:'lesson_booked',date:TODAY,at:NOW});
  await db.prepare("INSERT INTO user_settings(user_id,setting_key,value_json,updated_at) VALUES ('u','enabled_platforms','[\"telegram\"]',1)").run();
  const before = await readDashboardSnapshot(db,'u',NOW);
  assert.deepEqual(before.bookingGoal,{completed:5,target:5});
  assert.equal(before.platforms.find(row=>row.key==='telegram').responses,1);
  assert.equal(before.platforms.find(row=>row.key==='telegram').bookings,3);
  assert.equal(before.platforms.find(row=>row.key==='threads').bookings,1);
  assert.equal(before.platforms.find(row=>row.key==='threads').responses,1);
  assert.deepEqual(before.enabledPlatforms,['telegram']);
  await report(db);
  const after = await readDashboardSnapshot(db,'u',NOW);
  assert.deepEqual(after.platforms,before.platforms);
  assert.deepEqual(after.bookingGoal,before.bookingGoal);
  assert.equal(after.pendingAfterReport,0);
  await report(db,NOW,'Довільний відредагований звіт: 12345 записів');
  assert.deepEqual((await readDashboardSnapshot(db,'u',NOW)).bookingGoal,before.bookingGoal);
  assert.deepEqual((await readDashboardSnapshot(db,'u',NOW)).platforms,before.platforms);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM activity_events').first()).n,13);
  const summary = await activitySummaryStatement(db,'u',TODAY,TODAY).all();
  assert.equal(activityTotals(summary.results).bookings,after.bookingGoal.completed);
});

void test('new events and cancellations after report change Today once; configured zero goals are retained', async t => {
  const db = await localDatabase(t);
  await seedEvent(db,{id:'response',type:'lead_created',date:TODAY,at:NOW-100});
  await report(db);
  await seedEvent(db,{id:'new-booking',type:'lesson_booked',date:TODAY,at:NOW});
  const first = await readDashboardSnapshot(db,'u',NOW);
  assert.equal(first.bookingGoal.completed,1);
  assert.equal(first.pendingAfterReport,1);
  await db.prepare("UPDATE activity_events SET cancelled_at=?1 WHERE id='response'").bind(NOW).run();
  const cancelled = await readDashboardSnapshot(db,'u',NOW);
  assert.equal(cancelled.platforms.find(row=>row.key==='telegram').responses,0);
  assert.equal(cancelled.pendingAfterReport,2);
  await db.prepare("INSERT INTO user_settings(user_id,setting_key,value_json,updated_at) VALUES ('u','daily_booking_goal','0',1),('u','monthly_booking_goal','0',1)").run();
  const zero = await readDashboardSnapshot(db,'u',NOW);
  assert.deepEqual(zero.bookingGoal,{completed:1,target:0});
  assert.equal(zero.monthlyBookingGoal,0);
  assert.deepEqual((await readDashboardSnapshot(db,'u',NOW)).platforms,cancelled.platforms);
});

void test('archived leads retain events; attribution never reads a foreign-owner lead', async t => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,created_at,updated_at,archived_at)
    VALUES ('archived','u','Archived','viber','response',1,1,2),('foreign-lead','other','Private','facebook','response',1,1,NULL)`).run();
  await seedEvent(db,{id:'archived-event',type:'lesson_booked',date:TODAY,platform:null,lead:'archived'});
  await seedEvent(db,{id:'bad-link',type:'lesson_booked',date:TODAY,platform:null,lead:'foreign-lead'});
  const snapshot = await readDashboardSnapshot(db,'u',NOW);
  assert.equal(snapshot.leads,0);
  assert.equal(snapshot.platforms.find(row=>row.key==='viber').bookings,1);
  assert.equal(snapshot.platforms.find(row=>row.key==='facebook').bookings,0);
  assert.equal(snapshot.platforms.find(row=>row.key==='unknown').bookings,1);
  assert.equal(snapshot.bookingGoal.completed,2);
});

void test('Today lead queue returns only owned active overdue follow-ups and due reminders', async t => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,next_action,next_contact_at,created_at,updated_at,archived_at)
    VALUES
      ('overdue','u','Overdue lead','telegram','response','Call back',?1,1,1,NULL),
      ('future','u','Future lead','telegram','response','Later',?2,1,1,NULL),
      ('archived-task','u','Archived task','telegram','response','Ignore',?1,1,1,2),
      ('foreign-task','other','Foreign task','telegram','response','Private',?1,1,1,NULL),
      ('lesson-lead','u','Lesson lead','viber','response','',NULL,1,1,NULL)`)
    .bind(NOW - 120, NOW + 120).run();
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,teacher_name,lesson_date,lesson_time,lesson_platform,meeting_link,status,created_at,updated_at)
    VALUES ('lesson','u','lesson-lead','Student','Math','Teacher','2026-09-10','16:00','Google Meet','https://meet.google.com/abc-defg-hij','booked',1,1)`).run();
  await db.prepare(`INSERT INTO lesson_reminders(id,user_id,lesson_id,slot,enabled,offset_minutes,updated_at)
    VALUES ('lesson:reminder:1','u','lesson',1,1,60,1)`).run();

  const snapshot = await readDashboardSnapshot(db,'u',NOW);
  assert.deepEqual(snapshot.leadTasks.map(task => [task.kind, task.leadId]), [
    ['follow_up','overdue'],
    ['reminder','lesson-lead'],
  ]);
  assert.equal(snapshot.leadTaskCount, 2);
  assert.equal(snapshot.leadTasks[0].title, 'Call back');
  assert.equal(snapshot.leadTasks[1].lessonId, 'lesson');
});