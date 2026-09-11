import assert from 'node:assert/strict';
import test from 'node:test';
import { readReportEventDetails } from '../lib/reports/details.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const DATE = '2026-09-10';

void test('report event details are active, owner-scoped, bounded and read-only', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO leads(id,user_id,name,subject,platform,status,created_at,updated_at)
    VALUES ('lead-u','u','Олена','Англійська','telegram','response',1,1),('lead-other','other','Інший','Математика','telegram','response',1,1)`).run();
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,created_at,updated_at)
    VALUES ('lesson-u','u','lead-u','Олена','Математика',?1,1,1)`).bind(DATE).run();
  await seedEvent(db, { id: 'response-u', type: 'lead_created', date: DATE, at: 100, lead: 'lead-u' });
  await seedEvent(db, { id: 'booking-u', type: 'lesson_booked', date: DATE, at: 200, lead: 'lead-u', lesson: 'lesson-u' });
  await seedEvent(db, { id: 'cancelled-u', type: 'lead_created', date: DATE, at: 300, lead: 'lead-u', cancelled: 400 });
  await seedEvent(db, { id: 'response-other', owner: 'other', type: 'lead_created', date: DATE, at: 500, lead: 'lead-other' });

  const before = Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count);
  const details = await readReportEventDetails(db, 'u', DATE);
  assert.deepEqual(details.map((event) => event.id), ['response-u', 'booking-u']);
  assert.equal(details[0].leadName, 'Олена');
  assert.equal(details[1].lessonSubject, 'Математика');
  assert.equal((await readReportEventDetails(db, 'other', DATE))[0].id, 'response-other');
  assert.equal((await readReportEventDetails(db, 'u', DATE, 1)).length, 1);
  const after = Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count);
  assert.equal(after, before);
});
