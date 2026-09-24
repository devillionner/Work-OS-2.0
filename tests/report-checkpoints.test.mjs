import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonEpoch } from '../lib/leads/domain/time.ts';
import { readCheckpointSummary, readReportCheckpointPlan, saveReportCheckpoint } from '../lib/reports/checkpoints.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const DATE='2026-09-13';
const at=(time)=>lessonEpoch(DATE,time);

async function workday(db,{id='wd',user='u',start='09:00',end=null,status=end?'ended':'active'}={}){
  const started=at(start);const ended=end?at(end):null;
  await db.prepare(`INSERT INTO workdays(id,user_id,work_date,status,started_at,active_since,paused_at,ended_at,active_seconds,created_at,updated_at,version)
    VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,0,?5,?5,0)`)
    .bind(id,user,DATE,status,started,status==='active'?started:null,ended).run();
}

void test('checkpoint plan skips slots before shift start and exposes due/upcoming slots',async(t)=>{
  const db=await localDatabase(t);await workday(db,{start:'13:00'});
  const plan=await readReportCheckpointPlan(db,'u',DATE,at('14:00'),DATE);
  assert.deepEqual(plan.map(item=>[item.slot,item.state]),[['13:00','skipped'],['16:00','upcoming'],['19:00','upcoming']]);
});
void test('19:00 checkpoint is skipped when the shift ends around 19:30',async(t)=>{
  const db=await localDatabase(t);await workday(db,{start:'09:00',end:'19:30'});
  const plan=await readReportCheckpointPlan(db,'u',DATE,at('19:40'),DATE);
  assert.equal(plan.find(item=>item.slot==='19:00').state,'skipped');
  assert.match(plan.find(item=>item.slot==='19:00').reason,/фінальний/);
});

void test('due checkpoint saves owner-scoped snapshot and resubmission increments version',async(t)=>{
  const db=await localDatabase(t);await workday(db,{start:'09:00'});
  const first=await saveReportCheckpoint(db,{userId:'u',date:DATE,slot:'13:00',text:'Проміжний 1',payload:{responses:2},now:at('14:00'),today:DATE,expectedVersion:0});
  assert.equal(first.find(item=>item.slot==='13:00').state,'submitted');
  assert.equal(first.find(item=>item.slot==='13:00').version,1);
  const second=await saveReportCheckpoint(db,{userId:'u',date:DATE,slot:'13:00',text:'Проміжний 2',payload:{responses:3},now:at('14:05'),today:DATE,expectedVersion:1});
  assert.equal(second.find(item=>item.slot==='13:00').version,2);
  assert.equal(second.find(item=>item.slot==='13:00').text,'Проміжний 2');
  assert.deepEqual(await readReportCheckpointPlan(db,'other',DATE,at('14:05'),DATE),[]);
});

void test('stale checkpoint version cannot overwrite a newer submission',async(t)=>{
  const db=await localDatabase(t);await workday(db,{start:'09:00'});
  await saveReportCheckpoint(db,{userId:'u',date:DATE,slot:'13:00',text:'Перша',payload:{},now:at('14:00'),today:DATE,expectedVersion:0});
  await saveReportCheckpoint(db,{userId:'u',date:DATE,slot:'13:00',text:'Друга',payload:{},now:at('14:01'),today:DATE,expectedVersion:1});
  await assert.rejects(()=>saveReportCheckpoint(db,{userId:'u',date:DATE,slot:'13:00',text:'Застаріла',payload:{},now:at('14:02'),today:DATE,expectedVersion:1}),/уже змінився/);
  const plan=await readReportCheckpointPlan(db,'u',DATE,at('14:02'),DATE);
  assert.equal(plan.find(item=>item.slot==='13:00').text,'Друга');
});

void test('late checkpoint summary freezes counts at the slot cutoff',async(t)=>{
  const db=await localDatabase(t);
  await seedEvent(db,{id:'before',type:'lead_created',date:DATE,at:at('12:30')});
  await seedEvent(db,{id:'after',type:'lead_created',date:DATE,at:at('13:30')});
  await seedEvent(db,{id:'cancelled-later',type:'lesson_booked',date:DATE,at:at('12:40'),cancelled:at('13:20')});
  const summary=await readCheckpointSummary(db,'u',DATE,'13:00');
  const byType=Object.fromEntries(summary.map(row=>[row.event_type,Number(row.count)]));
  assert.equal(byType.lead_created,1);
  assert.equal(byType.lesson_booked,1);
});
