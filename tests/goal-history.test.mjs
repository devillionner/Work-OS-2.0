import assert from 'node:assert/strict';
import test from 'node:test';
import { goalVersionStatement, readGoalPlanFact } from '../lib/goals.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;

void test('goal history keeps past plans while same-day changes create ordered versions', async t => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,updated_at)
    VALUES ('u','daily_booking_goal','5',1),('u','monthly_booking_goal','100',1)`).run();
  await db.prepare(`INSERT INTO goal_versions(id,user_id,goal_key,effective_on,value,created_at,source,version)
    VALUES ('daily-base','u','daily_booking_goal','0001-01-01',5,1,'baseline',1),
      ('month-base','u','monthly_booking_goal','0001-01-01',100,1,'baseline',1)`).run();

  await db.batch([
    goalVersionStatement(db,{userId:'u',key:'daily_booking_goal',value:6,now:NOW,today:'2026-09-10'}),
    goalVersionStatement(db,{userId:'u',key:'daily_booking_goal',value:7,now:NOW+1,today:'2026-09-10'}),
    goalVersionStatement(db,{userId:'u',key:'monthly_booking_goal',value:120,now:NOW+2,today:'2026-09-10'}),
  ]);
  await db.prepare(`UPDATE user_settings SET value_json='7' WHERE user_id='u' AND setting_key='daily_booking_goal'`).run();
  await db.prepare(`UPDATE user_settings SET value_json='120' WHERE user_id='u' AND setting_key='monthly_booking_goal'`).run();

  await seedEvent(db,{id:'book-9',type:'lesson_booked',date:'2026-09-09',at:NOW-86400});
  await seedEvent(db,{id:'book-10a',type:'lesson_booked',date:'2026-09-10',at:NOW});
  await seedEvent(db,{id:'book-10b',type:'lesson_booked',date:'2026-09-10',at:NOW+1});
  await seedEvent(db,{id:'book-aug',type:'lesson_booked',date:'2026-08-20',at:NOW-21*86400});

  const yesterday=await readGoalPlanFact(db,'u','2026-09-09');
  const today=await readGoalPlanFact(db,'u','2026-09-10');
  const august=await readGoalPlanFact(db,'u','2026-08-20');
  assert.equal(yesterday.dailyTarget,5);
  assert.equal(today.dailyTarget,7);
  assert.equal(today.dailyActual,2);
  assert.equal(today.monthlyTarget,120);
  assert.equal(august.monthlyTarget,100);
  assert.equal(august.monthlyActual,1);

  const versions=await db.prepare(`SELECT goal_key,effective_on,value,version FROM goal_versions
    WHERE user_id='u' ORDER BY goal_key,version`).all();
  assert.deepEqual(versions.results.map(row=>[row.goal_key,row.effective_on,row.value,row.version]),[
    ['daily_booking_goal','0001-01-01',5,1],
    ['daily_booking_goal','2026-09-10',6,2],
    ['daily_booking_goal','2026-09-10',7,3],
    ['monthly_booking_goal','0001-01-01',100,1],
    ['monthly_booking_goal','2026-09-01',120,2],
  ]);
});

void test('dates before the first goal version keep canonical defaults', async t => {
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,updated_at)
    VALUES ('u','daily_booking_goal','9',1),('u','monthly_booking_goal','180',1)`).run();
  await db.batch([
    goalVersionStatement(db,{userId:'u',key:'daily_booking_goal',value:9,now:NOW,today:'2026-09-10'}),
    goalVersionStatement(db,{userId:'u',key:'monthly_booking_goal',value:180,now:NOW,today:'2026-09-10'}),
  ]);
  const old=await readGoalPlanFact(db,'u','2026-08-20');
  assert.equal(old.dailyTarget,5);
  assert.equal(old.monthlyTarget,100);
});


void test('manual goal change on the same effective date wins over imported restore history', async t => {
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO goal_versions
    (id,user_id,goal_key,effective_on,value,created_at,source,version)
    VALUES ('legacy-restore','u','daily_booking_goal','2026-09-10',8,?1,'restore',1000001)`)
    .bind(NOW-10).run();

  await db.batch([
    goalVersionStatement(db,{userId:'u',key:'daily_booking_goal',value:9,now:NOW,today:'2026-09-10'}),
  ]);

  const today=await readGoalPlanFact(db,'u','2026-09-10');
  assert.equal(today.dailyTarget,9);
  const rows=await db.prepare(`SELECT value,source,version,created_at FROM goal_versions
    WHERE user_id='u' AND goal_key='daily_booking_goal' ORDER BY created_at,version`).all();
  assert.deepEqual(rows.results.map(row=>[row.value,row.source,row.version]),[
    [8,'restore',1000001],
    [9,'manual',1],
  ]);
});
