import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDayStart } from '../lib/business-time.ts';
import { readCalendarContext } from '../lib/reports/calendar-context.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

void test('report calendar context is owner-scoped and combines workdays, lessons, follow-ups and lead events', async (t) => {
  const db = await localDatabase(t);
  const followAt = businessDayStart('2026-09-09') + 3600;

  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,next_action,next_contact_at,created_at,updated_at)
    VALUES
      ('lead','u','Lead','telegram','response','Call',?1,1,1),
      ('archived','u','Archived','telegram','response','Ignore',?1,1,1),
      ('foreign','other','Foreign','telegram','response','Private',?1,1,1)`).bind(followAt).run();
  await db.prepare(`UPDATE leads SET archived_at=2 WHERE id='archived'`).run();

  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,status,created_at,updated_at)
    VALUES
      ('lesson','u','lead','Student','Math','2026-09-09','booked',1,1),
      ('old-slot','u','lead','Student','Math','2026-09-09','rescheduled',1,1),
      ('foreign-lesson','other','foreign','Student','Math','2026-09-09','booked',1,1)`).run();
  await db.prepare(`INSERT INTO workdays(id,user_id,work_date,status,started_at,ended_at,active_seconds,created_at,updated_at)
    VALUES ('wd','u','2026-09-08','ended',10,20,3600,10,20)`).run();

  await seedEvent(db, { id: 'lead-event', owner: 'u', type: 'lead_created', date: '2026-09-09', lead: 'lead' });
  await seedEvent(db, { id: 'cancelled-event', owner: 'u', type: 'lead_created', date: '2026-09-09', lead: 'lead', cancelled: 200 });
  await seedEvent(db, { id: 'foreign-event', owner: 'other', type: 'lead_created', date: '2026-09-09', lead: 'foreign' });

  const context = await readCalendarContext(db, 'u', '2026-09-01', '2026-10-01');
  const byDate = new Map(context.map((item) => [item.date, item]));

  assert.deepEqual(byDate.get('2026-09-08'), {
    date: '2026-09-08', workdayStatus: 'ended', activeSeconds: 3600,
    lessons: 0, followUps: 0, leadEvents: 0,
  });
  assert.deepEqual(byDate.get('2026-09-09'), {
    date: '2026-09-09', workdayStatus: null, activeSeconds: 0,
    lessons: 1, followUps: 1, leadEvents: 1,
  });
});
