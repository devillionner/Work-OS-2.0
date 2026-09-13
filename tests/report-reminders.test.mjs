import assert from 'node:assert/strict';
import test from 'node:test';
import { readPreviousReportReminder } from '../lib/reports/reminders.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

void test('yesterday reminder appears only for a worked day without submitted report', async (t) => {
  const db = await localDatabase(t);
  assert.deepEqual(await readPreviousReportReminder(db,'u','2026-09-13'), { date:'2026-09-12', pending:false });
  await seedEvent(db,{id:'worked',type:'lead_created',date:'2026-09-12',at:100});
  assert.deepEqual(await readPreviousReportReminder(db,'u','2026-09-13'), { date:'2026-09-12', pending:true });
  await db.prepare(`INSERT INTO daily_reports(id,user_id,report_date,report_text,payload_json,submitted_at,updated_at)
    VALUES ('r','u','2026-09-12','Звіт','{}',200,200)`).run();
  assert.deepEqual(await readPreviousReportReminder(db,'u','2026-09-13'), { date:'2026-09-12', pending:false });
});
