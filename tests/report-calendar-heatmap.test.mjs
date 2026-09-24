import assert from 'node:assert/strict';
import test from 'node:test';
import { reportRevisionHeatClass } from '../lib/reports/calendar-heatmap.ts';

void test('report revision heatmap is neutral without a report and bounded at four-plus revisions', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 12].map(reportRevisionHeatClass),
    ['', 'revision-1', 'revision-2', 'revision-3', 'revision-4', 'revision-4'],
  );
});
