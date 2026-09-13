import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalyticsTrends } from '../lib/analytics-trends.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

void test('daily trends fill zero days and isolate owner and cancelled events', async (t) => {
  const db = await localDatabase(t);
  await seedEvent(db,{id:'join',type:'chat_joined',date:'2026-09-10'});
  await seedEvent(db,{id:'pub',type:'publication',date:'2026-09-10'});
  await seedEvent(db,{id:'lead',type:'lead_created',date:'2026-09-12'});
  await seedEvent(db,{id:'book',type:'lesson_booked',date:'2026-09-12'});
  await seedEvent(db,{id:'pending',type:'curator_booking_pending',date:'2026-09-12'});
  await seedEvent(db,{id:'cancelled',type:'publication',date:'2026-09-11',cancelled:200});
  await seedEvent(db,{id:'foreign',owner:'other',type:'lead_created',date:'2026-09-11'});

  const points=await readAnalyticsTrends(db,'u','2026-09-10','2026-09-12');
  assert.deepEqual(points,[
    {date:'2026-09-10',joined:1,publications:1,responses:0,bookings:0,completed:0},
    {date:'2026-09-11',joined:0,publications:0,responses:0,bookings:0,completed:0},
    {date:'2026-09-12',joined:0,publications:0,responses:1,bookings:2,completed:0},
  ]);
});
