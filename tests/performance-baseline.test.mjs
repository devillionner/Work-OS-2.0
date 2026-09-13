import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { readSubjectAnalytics } from '../lib/reports/subjects.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('10k leads / 100k events analytics stays bounded and owner-scoped', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`WITH RECURSIVE seq(n) AS (
      VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000
    ) INSERT INTO leads(id,user_id,name,subject,platform,status,created_at,updated_at)
    SELECT 'perf-lead-'||n,'u','Lead '||n,
      CASE n%4 WHEN 0 THEN 'Англійська' WHEN 1 THEN 'English' WHEN 2 THEN 'Математика' ELSE '' END,
      'telegram','response',1,1 FROM seq`).run();

  await db.prepare(`WITH RECURSIVE digit(n) AS (
      VALUES(0) UNION ALL SELECT n+1 FROM digit WHERE n<9
    ) INSERT INTO activity_events(
      id,user_id,event_type,platform,lead_id,occurred_at,event_date,metadata_json,source_key
    )
    SELECT 'perf-event-'||l.id||'-'||digit.n,'u',
      CASE WHEN digit.n<5 THEN 'lead_created' ELSE 'lesson_booked' END,
      'telegram',l.id,100+digit.n,'2026-09-10','{}','perf:'||l.id||':'||digit.n
    FROM leads l CROSS JOIN digit
    WHERE l.user_id='u' AND l.id LIKE 'perf-lead-%'`).run();
  await db.prepare(`INSERT INTO leads(id,user_id,name,subject,platform,status,created_at,updated_at)
    VALUES ('perf-other','other','Other','Англійська','telegram','response',1,1)`).run();
  await db.prepare(`INSERT INTO activity_events(
      id,user_id,event_type,platform,lead_id,occurred_at,event_date,metadata_json,source_key
    ) VALUES ('perf-other-event','other','lead_created','telegram','perf-other',1,'2026-09-10','{}','perf:other')`).run();

  const started = performance.now();
  const result = await readSubjectAnalytics(db, 'u', '2026-09-10', 'day');
  const durationMs = performance.now() - started;

  assert.equal(result.total.responses, 50000);
  assert.equal(result.total.bookings, 50000);
  assert.equal(result.rows.some((row) => row.subject === 'Англійська'), true);
  assert.equal(result.rows.some((row) => row.subject === 'Предмет не вказано'), true);
  assert.equal(result.total.responses + result.total.bookings, 100000);
  assert.ok(durationMs < 5000, `subject analytics took ${Math.round(durationMs)}ms`);
  t.diagnostic(`10k leads / 100k events subject analytics: ${Math.round(durationMs)}ms`);
});
