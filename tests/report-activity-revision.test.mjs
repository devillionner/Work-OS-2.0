import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudBackupSha256 } from '../lib/backups/inspect.ts';
import { restoreMissingChunk } from '../lib/backups/restore.ts';
import { readDashboardSnapshot } from '../lib/dashboard-data.ts';
import { readActivityDayRevision } from '../lib/reports/activity-revision.ts';
import { readReportCalendar } from '../lib/reports/calendar.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const DATE='2026-09-14';
const NEXT='2026-09-15';
const SECOND=Date.parse('2026-09-14T10:00:00Z')/1000;

async function saveSubmittedReport(db,{date=DATE,submittedAt=SECOND,revision=null,id=`report_u_${date}`}={}){
  const snapshot=revision===null?await readActivityDayRevision(db,'u',date):revision;
  await db.prepare(`INSERT INTO daily_reports
    (id,user_id,report_date,report_text,payload_json,submitted_at,submitted_activity_revision,updated_at,source_import_id)
    VALUES (?1,'u',?2,'Report','{}',?3,?4,?3,NULL)`).bind(id,date,submittedAt,snapshot).run();
  return snapshot;
}

async function stale(db,date=DATE){
  const rows=await readReportCalendar(db,'u',date,date===DATE?'2026-09-15':'2026-09-16');
  return rows[0]?.stale;
}

void test('event inserted in the exact submission second makes the report stale',async t=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'before',type:'lead_created',date:DATE,at:SECOND});
  await saveSubmittedReport(db);
  assert.equal(await stale(db),false);
  await seedEvent(db,{id:'after',type:'lesson_booked',date:DATE,at:SECOND});
  assert.equal(await stale(db),true);
});

void test('same-second cancellation after submission is detected exactly',async t=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'response',type:'lead_created',date:DATE,at:SECOND});
  await saveSubmittedReport(db);
  assert.equal(await stale(db),false);
  await db.prepare(`UPDATE activity_events SET cancelled_at=?1 WHERE id='response' AND user_id='u'`).bind(SECOND).run();
  assert.equal(await stale(db),true);
});

void test('other dates and technical events do not stale the submitted report',async t=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'before',type:'publication',date:DATE,at:SECOND});
  const snapshot=await saveSubmittedReport(db);
  await seedEvent(db,{id:'tomorrow',type:'lead_created',date:NEXT,at:SECOND});
  await seedEvent(db,{id:'technical',type:'chat_state_changed',date:DATE,at:SECOND});
  assert.equal(await readActivityDayRevision(db,'u',DATE),snapshot);
  assert.equal(await stale(db),false);
});

void test('moving a report-relevant event across dates advances both day revisions',async t=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'moving',type:'lead_created',date:DATE,at:SECOND});
  const beforeA=await readActivityDayRevision(db,'u',DATE);
  const beforeB=await readActivityDayRevision(db,'u',NEXT);
  await db.prepare(`UPDATE activity_events SET event_date=?1 WHERE id='moving' AND user_id='u'`).bind(NEXT).run();
  assert.equal(await readActivityDayRevision(db,'u',DATE),beforeA+1);
  assert.equal(await readActivityDayRevision(db,'u',NEXT),beforeB+1);
});

void test('legacy reports without a revision keep the timestamp fallback',async t=>{
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO daily_reports
    (id,user_id,report_date,report_text,payload_json,submitted_at,submitted_activity_revision,updated_at,source_import_id)
    VALUES ('legacy','u',?1,'Legacy','{}',?2,NULL,?2,NULL)`).bind(DATE,SECOND).run();
  await seedEvent(db,{id:'same-second',type:'lead_created',date:DATE,at:SECOND});
  assert.equal(await stale(db),false);
  await seedEvent(db,{id:'later',type:'lead_created',date:DATE,at:SECOND+1});
  assert.equal(await stale(db),true);
});

void test('Today pendingAfterReport uses the exact day revision delta',async t=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'before',type:'lead_created',date:DATE,at:SECOND});
  await saveSubmittedReport(db);
  await seedEvent(db,{id:'same-second-after',type:'lesson_booked',date:DATE,at:SECOND});
  const snapshot=await readDashboardSnapshot(db,'u',SECOND);
  assert.equal(snapshot.today,DATE);
  assert.equal(snapshot.pendingAfterReport,1);
});

void test('restored reports clear derived activity snapshots and safely use legacy fallback',async t=>{
  const db=await localDatabase(t);
  const payload=JSON.stringify([{
    id:'restored-report',user_id:'backup-owner',report_date:DATE,report_text:'Restored',payload_json:'{}',
    submitted_at:SECOND,submitted_activity_revision:99,updated_at:SECOND,source_import_id:null,revision_count:1,
  }]);
  const result=await restoreMissingChunk({
    db,table:'daily_reports',payload,sha256:await cloudBackupSha256(payload),rowCount:1,userId:'u',
  });
  assert.equal(result.inserted,1);
  assert.equal(await db.prepare(`SELECT submitted_activity_revision FROM daily_reports WHERE id='restored-report'`).first('submitted_activity_revision'),null);
});
