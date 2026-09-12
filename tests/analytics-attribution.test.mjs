import assert from 'node:assert/strict';
import test from 'node:test';
import { completedOperatorLessonsStatement } from '../lib/analytics-attribution.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('completed analytics counts only lessons attributed to an operator booking', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,created_at,updated_at)
    VALUES ('lead','u','Lead','telegram','booked',1,1)`).run();
  for (const [id,date] of [['mine','2026-09-10'],['school','2026-09-10'],['cancelled','2026-09-10']]) {
    await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,status,created_at,updated_at)
      VALUES (?1,'u','lead','Student','English',?2,'completed',1,1)`).bind(id,date).run();
  }
  await db.prepare(`INSERT INTO activity_events
    (id,user_id,event_type,platform,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,cancelled_at)
    VALUES ('event-mine','u','lesson_booked','telegram','lead','mine',1,'2026-09-10','{}','mine',NULL),
           ('event-cancelled','u','lesson_booked','telegram','lead','cancelled',1,'2026-09-10','{}','cancelled',2)`).run();
  const rows = (await completedOperatorLessonsStatement(db,'u','2026-09-01','2026-09-30').all()).results;
  assert.deepEqual(rows, [{ platform: 'telegram', count: 1 }]);
});
