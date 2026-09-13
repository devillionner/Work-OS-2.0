import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonEpoch } from '../lib/leads/domain/time.ts';
import { readFinalReportState } from '../lib/reports/final.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const DATE='2026-09-13';
const at=(time)=>lessonEpoch(DATE,time);

async function workday(db,{status='active',end=null}={}) {
  const start=at('09:00'); const ended=end?at(end):null;
  await db.prepare(`INSERT INTO workdays(id,user_id,work_date,status,started_at,active_since,paused_at,ended_at,active_seconds,created_at,updated_at,version)
    VALUES ('wd','u',?1,?2,?3,?4,NULL,?5,0,?3,?3,0)`)
    .bind(DATE,status,start,status==='active'?start:null,ended).run();
}

void test('current final report waits for shift end or 23:00',async(t)=>{
  const db=await localDatabase(t); await workday(db);
  const state=await readFinalReportState(db,'u',DATE,at('19:30'),DATE);
  assert.equal(state.canSubmit,false); assert.match(state.reason,/23:00/);
});

void test('ended shift unlocks current final report immediately',async(t)=>{
  const db=await localDatabase(t); await workday(db,{status:'ended',end:'19:30'});
  const state=await readFinalReportState(db,'u',DATE,at('19:31'),DATE);
  assert.equal(state.canSubmit,true); assert.equal(state.reason,null);
});

void test('23:00 and historical dates allow final submission',async(t)=>{
  const db=await localDatabase(t); await workday(db);
  assert.equal((await readFinalReportState(db,'u',DATE,at('23:00'),DATE)).canSubmit,true);
  assert.equal((await readFinalReportState(db,'u','2026-09-12',at('10:00'),DATE)).canSubmit,true);
});
