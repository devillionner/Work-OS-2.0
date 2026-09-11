import assert from 'node:assert/strict';
import test from 'node:test';
import { activitySummaryStatement } from '../lib/activity-summary.ts';
import { readReportHistory } from '../lib/reports/history.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const DATE = '2026-09-10';

void test('report saves create owner-scoped bounded history without entering activity totals', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO daily_reports(id,user_id,report_date,report_text,payload_json,submitted_at,updated_at)
    VALUES ('report-u','u',?1,'Перший текст','{}',10,10),('report-other','other',?1,'Чужий текст','{}',10,10)`).bind(DATE).run();
  await db.prepare(`UPDATE daily_reports SET report_text='Другий текст',submitted_at=20,updated_at=20,revision_count=revision_count+1 WHERE id='report-u'`).run();
  await db.prepare(`UPDATE daily_reports SET report_text='Третій текст',submitted_at=NULL,updated_at=30,revision_count=revision_count+1 WHERE id='report-u'`).run();

  const history = await readReportHistory(db, 'u', DATE);
  assert.deepEqual(history.map((item) => item.text), ['Третій текст', 'Другий текст', 'Перший текст']);
  assert.deepEqual(history.map((item) => item.revision), [3, 2, 1]);
  assert.equal(history[0].submittedAt, null);
  assert.equal((await readReportHistory(db, 'other', DATE))[0].text, 'Чужий текст');
  assert.equal((await readReportHistory(db, 'u', DATE, 2)).length, 2);
  assert.equal((await activitySummaryStatement(db, 'u', DATE, DATE).all()).results.length, 0);
});
