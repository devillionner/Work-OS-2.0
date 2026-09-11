import assert from 'node:assert/strict';
import test from 'node:test';
import { readLeadHistory } from '../lib/leads/history.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

async function seedLead(db, id, owner = 'u') {
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,created_at,updated_at)
    VALUES (?1,?2,?1,'telegram','response',1,1)`).bind(id, owner).run();
}

void test('lead history is newest first, bounded, owner-scoped and read-only', async (t) => {
  const db = await localDatabase(t);
  await seedLead(db, 'lead');
  await seedLead(db, 'other-lead', 'other');
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,created_at,updated_at)
    VALUES ('lesson','u','lead','Учень','Математика','2026-09-12',1,1),('other-lesson','u','lead','Учень','Англійська','2026-09-13',1,1)`).run();
  await seedEvent(db, { id: 'old', type: 'lead_created', lead: 'lead', date: '2026-09-10', at: 10 });
  await seedEvent(db, { id: 'new', type: 'lesson_booked', lead: 'lead', lesson: 'lesson', date: '2026-09-11', at: 20, metadata: { lessonDate: '2026-09-12' } });
  await seedEvent(db, { id: 'other-lesson-event', type: 'lesson_updated', lead: 'lead', lesson: 'other-lesson', date: '2026-09-11', at: 5 });
  await seedEvent(db, { id: 'foreign', type: 'lead_created', lead: 'other-lead', owner: 'other', date: '2026-09-11', at: 30 });
  const before = await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first();
  const events = await readLeadHistory(db, 'u', 'lead');
  assert.deepEqual(events.map((event) => event.id), ['new', 'old', 'other-lesson-event']);
  assert.deepEqual(events[0].metadata, { lessonDate: '2026-09-12' });
  assert.deepEqual(await readLeadHistory(db, 'u', 'lead', 1).then((items) => items.map((item) => item.id)), ['new']);
  assert.deepEqual(await readLeadHistory(db, 'u', 'lead', 50, 'lesson').then((items) => items.map((item) => item.id)), ['new']);
  assert.deepEqual(await readLeadHistory(db, 'other', 'lead'), []);
  assert.deepEqual(await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first(), before);
});
