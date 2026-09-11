import assert from 'node:assert/strict';
import test from 'node:test';
import { readReportCalendar } from '../lib/reports/calendar.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

void test('report calendar marks submitted reports stale after active or cancelled events', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO daily_reports(id,user_id,report_date,report_text,payload_json,submitted_at,updated_at)
    VALUES ('report-stale','u','2026-09-10','Звіт','{}',100,100),('report-clean','u','2026-09-09','Звіт','{}',300,300),('report-draft','u','2026-09-08','Чернетка','{}',NULL,100)`).run();
  await seedEvent(db, { id: 'after-submit', type: 'lead_created', date: '2026-09-10', at: 200 });
  await seedEvent(db, { id: 'cancelled-after-submit', type: 'lesson_booked', date: '2026-09-10', at: 90, cancelled: 250 });
  await seedEvent(db, { id: 'before-submit', type: 'lead_created', date: '2026-09-09', at: 200 });
  await seedEvent(db, { id: 'draft-event', type: 'lead_created', date: '2026-09-08', at: 200 });
  await seedEvent(db, { id: 'other-owner-event', owner: 'other', type: 'lead_created', date: '2026-09-10', at: 400 });

  const before = Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count);
  const reports = await readReportCalendar(db, 'u', '2026-09-01', '2026-10-01');
  assert.equal(reports.find((report) => report.date === '2026-09-10')?.stale, true);
  assert.equal(reports.find((report) => report.date === '2026-09-09')?.stale, false);
  assert.equal(reports.find((report) => report.date === '2026-09-08')?.stale, false);
  assert.equal(Number((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events`).first()).count), before);
});
