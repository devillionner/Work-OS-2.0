import assert from 'node:assert/strict';
import test from 'node:test';
import { readReportEventDetails } from '../lib/reports/details.ts';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';

const DATE = '2026-09-10';

void test('report event details expose active owner-scoped chat, response and booking sources without writes', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat-u', owner: 'u', platform: 'telegram' });
  await seedChat(db, { id: 'chat-other', owner: 'other', platform: 'telegram' });
  await db.prepare(`INSERT INTO leads(id,user_id,name,subject,platform,status,created_at,updated_at)
    VALUES ('lead-u','u','Олена','Англійська','telegram','response',1,1),('lead-other','other','Інший','Математика','telegram','response',1,1)`).run();
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,created_at,updated_at)
    VALUES ('lesson-u','u','lead-u','Олена','Математика',?1,1,1)`).bind(DATE).run();
  await seedEvent(db, { id: 'joined-u', type: 'chat_joined', date: DATE, at: 50, chat: 'chat-u' });
  await seedEvent(db, { id: 'publication-u', type: 'publication', date: DATE, at: 75, chat: 'chat-u' });
  await seedEvent(db, { id: 'response-u', type: 'lead_created', date: DATE, at: 100, lead: 'lead-u' });
  await seedEvent(db, { id: 'booking-u', type: 'lesson_booked', date: DATE, at: 200, lead: 'lead-u', lesson: 'lesson-u' });
  await seedEvent(db, { id: 'cancelled-u', type: 'publication', date: DATE, at: 300, chat: 'chat-u', cancelled: 400 });
  await seedEvent(db, { id: 'response-other', owner: 'other', type: 'lead_created', date: DATE, at: 500, lead: 'lead-other' });
  await seedEvent(db, { id: 'joined-other', owner: 'other', type: 'chat_joined', date: DATE, at: 510, chat: 'chat-other' });
  await seedEvent(db, { id: 'response-backdated', type: 'lead_created', date: DATE, at: 1789300800, lead: 'lead-u' });

  const before = Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count);
  const details = await readReportEventDetails(db, 'u', DATE);
  assert.deepEqual(details.map((event) => event.id), ['joined-u', 'publication-u', 'response-u', 'booking-u', 'response-backdated']);
  assert.equal(details[0].chatId, 'chat-u');
  assert.equal(details[0].chatName, 'chat-u');
  assert.equal(details[1].chatName, 'chat-u');
  assert.equal(details[2].leadName, 'Олена');
  assert.equal(details[3].lessonSubject, 'Математика');
  assert.equal(details[4].leadName, 'Олена · Додано заднім числом');
  const other = await readReportEventDetails(db, 'other', DATE);
  assert.deepEqual(other.map((event) => event.id), ['response-other', 'joined-other']);
  assert.equal(other[1].chatName, 'chat-other');
  assert.equal((await readReportEventDetails(db, 'u', DATE, 1)).length, 1);
  const after = Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count);
  assert.equal(after, before);
});
