import assert from 'node:assert/strict';
import test from 'node:test';
import { readTodayLeadsActivity } from '../lib/leads/today.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

async function seedLead(db, id, owner = 'u') {
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,subject,created_at,updated_at)
    VALUES (?1,?2,?3,'telegram','active','English',1,1)`)
    .bind(id, owner, `Lead ${id}`)
    .run();
}

void test('today Leads counters keep event facts while presentation lists deduplicate response vs booking', async (t) => {
  const db = await localDatabase(t);
  for (const id of ['both', 'response-only', 'booking-twice', 'cancelled']) await seedLead(db, id);
  await seedLead(db, 'foreign', 'other');

  await seedEvent(db, { id: 'both-response', type: 'lead_created', date: '2026-09-16', at: 100, lead: 'both' });
  await seedEvent(db, { id: 'both-booking', type: 'lesson_booked', date: '2026-09-16', at: 200, lead: 'both' });
  await seedEvent(db, { id: 'response-only-event', type: 'lead_created', date: '2026-09-16', at: 150, lead: 'response-only' });
  await seedEvent(db, { id: 'booking-one', type: 'curator_booking_pending', date: '2026-09-16', at: 170, lead: 'booking-twice' });
  await seedEvent(db, { id: 'booking-two', type: 'lesson_booked', date: '2026-09-16', at: 180, lead: 'booking-twice' });
  await seedEvent(db, { id: 'cancelled-response', type: 'lead_created', date: '2026-09-16', at: 190, lead: 'cancelled', cancelled: 220 });
  await seedEvent(db, { id: 'old-response', type: 'lead_created', date: '2026-09-15', at: 90, lead: 'cancelled' });
  await seedEvent(db, { id: 'foreign-response', owner: 'other', type: 'lead_created', date: '2026-09-16', at: 300, lead: 'foreign' });

  const result = await readTodayLeadsActivity(db, 'u', '2026-09-16');
  assert.deepEqual(result.counters, { responses: 2, bookings: 3 });
  assert.deepEqual(result.responses.map((item) => item.id), ['response-only']);
  assert.deepEqual(result.bookings.map((item) => item.id), ['both', 'booking-twice']);
  assert.equal(result.bookings.find((item) => item.id === 'booking-twice')?.eventCount, 2);
  assert.equal(result.bookings.find((item) => item.id === 'booking-twice')?.latestAt, 180);
});
