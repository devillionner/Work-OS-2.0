import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyReportManualAdjustments,
  reportFactTotals,
  reportManualAdjustmentsAreValidForFacts,
  reportManualAdjustmentsFromPayload,
  validateReportManualAdjustments,
  writeReportManualAdjustmentsPayload,
} from '../lib/reports/manual-adjustments.ts';

void test('manual report adjustments are bounded integer deltas', () => {
  assert.deepEqual(validateReportManualAdjustments(undefined), { publications: 0, responses: 0, bookings: 0 });
  assert.deepEqual(validateReportManualAdjustments({ publications: -2, responses: 3, bookings: 0 }), { publications: -2, responses: 3, bookings: 0 });
  assert.equal(validateReportManualAdjustments({ publications: 1.5, responses: 0, bookings: 0 }), null);
  assert.equal(validateReportManualAdjustments({ publications: '1', responses: 0, bookings: 0 }), null);
  assert.equal(validateReportManualAdjustments({ publications: 10000, responses: 0, bookings: 0 }), null);
});

void test('manual report payload preserves existing metadata and tracks the exact mutation', () => {
  assert.deepEqual(reportManualAdjustmentsFromPayload('{"source":"import"}'), { publications: 0, responses: 0, bookings: 0 });
  const payload = writeReportManualAdjustmentsPayload('{"legacyId":"r1","source":"import"}', { publications: 1, responses: -1, bookings: 2 }, 123, 'mutation-1');
  const parsed = JSON.parse(payload);
  assert.equal(parsed.legacyId, 'r1');
  assert.equal(parsed.source, 'manual');
  assert.equal(parsed.updatedAt, 123);
  assert.equal(parsed.manualAdjustmentMutationId, 'mutation-1');
  assert.deepEqual(parsed.manualAdjustments, { publications: 1, responses: -1, bookings: 2 });
  assert.deepEqual(reportManualAdjustmentsFromPayload(payload), { publications: 1, responses: -1, bookings: 2 });
});

void test('report fact and adjusted totals keep activity events authoritative', () => {
  const facts = reportFactTotals([
    { eventType: 'publication', count: 7 },
    { eventType: 'lead_created', count: 4 },
    { eventType: 'lesson_booked', count: 2 },
    { eventType: 'curator_booking_pending', count: 1 },
    { eventType: 'chat_joined', count: 99 },
  ]);
  assert.deepEqual(facts, { publications: 7, responses: 4, bookings: 3 });
  assert.deepEqual(applyReportManualAdjustments(facts, { publications: -1, responses: 2, bookings: 0 }), { publications: 6, responses: 6, bookings: 3 });
  assert.equal(reportManualAdjustmentsAreValidForFacts(facts, { publications: -7, responses: -4, bookings: -3 }), true);
  assert.equal(reportManualAdjustmentsAreValidForFacts(facts, { publications: -8, responses: 0, bookings: 0 }), false);
});

void test('REPORT-22 UI exposes fact, explicit correction, result and per-number sources', async () => {
  const source = await readFile(new URL('../components/report-manual-diff.tsx', import.meta.url), 'utf8');
  assert.match(source, /Авто-факт/);
  assert.match(source, /Ручна корекція/);
  assert.match(source, /Підсумок звіту/);
  assert.match(source, /Джерела авто-факту/);
  assert.match(source, /activity events/);
  assert.match(source, /Today та Analytics/);
});

void test('REPORT-22 write path is owner scoped, optimistic and versioned in report history', async () => {
  const source = await readFile(new URL('../app/api/reports/manual-adjustments/route.ts', import.meta.url), 'utf8');
  assert.match(source, /sameOrigin\(request\)/);
  assert.match(source, /WHERE user_id=\?3 AND report_date=\?4 AND COALESCE\(revision_count,1\)=\?5/);
  assert.match(source, /manualAdjustmentMutationId/);
  assert.match(source, /INSERT OR IGNORE INTO activity_events/);
  assert.match(source, /'report_revision'/);
  assert.match(source, /'manualAdjustments'/);
  assert.match(source, /Звіт уже змінено на іншому пристрої/);
  assert.match(source, /activitySummaryStatement/);
  assert.match(source, /readReportEventDetails/);
});

void test('report history renders the manual delta for correction-only revisions', async () => {
  const source = await readFile(new URL('../components/report-history-dialog.tsx', import.meta.url), 'utf8');
  assert.match(source, /Корекція · оголошення/);
  assert.match(source, /manualAdjustments/);
});
