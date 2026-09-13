import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalyticsCohort } from '../lib/analytics-cohort.ts';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';

void test('cohort analytics follows lead acquisition date and keeps later outcomes attributed to the original chat', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat-a', owner: 'u', platform: 'telegram' });
  await seedChat(db, { id: 'chat-b', owner: 'u', platform: 'whatsapp' });
  await seedChat(db, { id: 'chat-other', owner: 'other', platform: 'telegram' });
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,source_chat_id,status,archived_at,created_at,updated_at)
    VALUES
      ('lead-a','u','A','telegram','chat-a','booked',999,1,1),
      ('lead-b','u','B','whatsapp','chat-b','response',NULL,1,1),
      ('lead-old','u','Old','telegram','chat-a','booked',NULL,1,1),
      ('lead-cancelled','u','Cancelled','telegram','chat-a','response',NULL,1,1),
      ('lead-other','other','Other','telegram','chat-other','booked',NULL,1,1)`).run();
  await seedEvent(db, { id: 'response-a', type: 'lead_created', date: '2026-09-02', lead: 'lead-a', chat: 'chat-a' });
  await seedEvent(db, { id: 'response-b', type: 'lead_created', date: '2026-09-03', lead: 'lead-b', chat: 'chat-b' });
  await seedEvent(db, { id: 'response-old', type: 'lead_created', date: '2026-08-20', lead: 'lead-old', chat: 'chat-a' });
  await seedEvent(db, { id: 'response-cancelled', type: 'lead_created', date: '2026-09-04', lead: 'lead-cancelled', chat: 'chat-a', cancelled: 200 });
  await seedEvent(db, { id: 'response-other', owner: 'other', type: 'lead_created', date: '2026-09-05', lead: 'lead-other', chat: 'chat-other' });

  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,status,created_at,updated_at)
    VALUES
      ('lesson-a','u','lead-a','A','English','2026-10-01','completed',1,1),
      ('lesson-old','u','lead-old','Old','English','2026-09-08','completed',1,1),
      ('lesson-other','other','lead-other','Other','English','2026-09-09','completed',1,1)`).run();
  await seedEvent(db, { id: 'book-a', type: 'lesson_booked', date: '2026-09-20', lead: 'lead-a', lesson: 'lesson-a', chat: 'chat-a' });
  await seedEvent(db, { id: 'pending-a', type: 'curator_booking_pending', date: '2026-10-02', lead: 'lead-a', chat: 'chat-a' });
  await seedEvent(db, { id: 'book-old', type: 'lesson_booked', date: '2026-09-08', lead: 'lead-old', lesson: 'lesson-old', chat: 'chat-a' });
  await seedEvent(db, { id: 'book-other', owner: 'other', type: 'lesson_booked', date: '2026-09-09', lead: 'lead-other', lesson: 'lesson-other', chat: 'chat-other' });

  const cohort = await readAnalyticsCohort(db, 'u', '2026-09-01', '2026-09-10');
  assert.deepEqual(cohort.totals, { leads: 2, bookedLeads: 1, bookings: 2, completed: 1 });
  assert.deepEqual(cohort.platforms, [
    { platform: 'telegram', leads: 1, bookedLeads: 1, bookings: 2, completed: 1 },
    { platform: 'whatsapp', leads: 1, bookedLeads: 0, bookings: 0, completed: 0 },
  ]);
  assert.deepEqual(cohort.chats.map(({ id, leads, bookings, completed }) => ({ id, leads, bookings, completed })), [
    { id: 'chat-a', leads: 1, bookings: 2, completed: 1 },
    { id: 'chat-b', leads: 1, bookings: 0, completed: 0 },
  ]);
  assert.deepEqual((await readAnalyticsCohort(db, 'other', '2026-09-01', '2026-09-10')).totals, { leads: 1, bookedLeads: 1, bookings: 1, completed: 1 });
});
