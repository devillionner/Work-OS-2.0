import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/reports/subjects/route.ts', import.meta.url), 'utf8');

void test('subject analytics endpoint is authenticated, bounded to valid dates and validates period', () => {
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /SUBJECT_PERIODS\.includes/);
  assert.match(route, /Майбутня дата недоступна/);
  assert.match(route, /readSubjectAnalytics\(env\.DB, user\.id, date, period as SubjectPeriod\)/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});
