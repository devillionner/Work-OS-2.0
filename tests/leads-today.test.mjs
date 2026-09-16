import assert from 'node:assert/strict';
import test from 'node:test';
import { readTodayLeadsActivity } from '../lib/leads/today.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

async function lead(db, id, owner = 'u') {
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,funnel_stage,created_at,updated_at)
    VALUES (?1,?2,?1,'telegram','active','response',1,1)`).bind(id, owner).run();
}

void test('Today Leads keeps event counters exact while showing each contact in one list', async (t) => {
  const db = await localDatabase(t);
  await lead(db, 'response');
  await lead(db, 'booked');
  await lead(db, 'cancelled');
  await lead(db, 'foreign', 'other');

  await seedEvent(db, { id: 'response-1', type: 'lead_created', date: '2026-09-16', at: 10, lead: 'response' });
  await seedEvent(db, { id: 'booked-response', type: 'lead_created', date: '2026-09-16', at: 20, lead: 'booked' });
  await seedEvent(db, { id: 'booked-1', type: 'lesson_booked', date: '2026-09-16', at: 30, lead: 'booked' });
  await seedEvent(db, { id: 'booked-2', type: 'curator_booking_pending', date: '2026-09-16', at: 40, lead: 'booked' });
  await seedEvent(db, { id: 'cancelled-response', type: 'lead_created', date: '2026-09-16', at: 50, lead: 'cancelled', cancelled: 60 });
  await seedEvent(db, { id: 'foreign-response', owner: 'other', type: 'lead_created', date: '2026-09-16', at: 70, lead: 'foreign' });

  const result = await readTodayLeadsActivity(db, 'u', '2026-09-16');
  assert.deepEqual(result.counters, { responses: 2, bookings: 2 });
  assert.deepEqual(result.responses.map((item) => item.id), ['response']);
  assert.deepEqual(result.bookings.map((item) => item.id), ['booked']);
  assert.equal(result.bookings[0].eventCount, 2);
  assert.equal(result.bookings[0].latestAt, 40);
});
