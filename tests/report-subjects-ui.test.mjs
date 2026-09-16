import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('../components/report-subject-analytics.tsx', import.meta.url), 'utf8');
const checkpoints = readFileSync(new URL('../components/report-checkpoints.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/reports/subjects/route.ts', import.meta.url), 'utf8');

void test('Reports exposes subject analytics for all required operator periods', () => {
  for (const key of ['day', '7', '30', 'month', 'all']) assert.match(component, new RegExp(`key: '${key}'`));
  for (const label of ['Предмет', 'Відгуки', 'Записи', 'Конверсія', 'Частка відгуків', 'Частка записів']) assert.match(component, new RegExp(label));
  assert.match(component, /function percent\([\s\S]*denominator > 0[\s\S]*: '—'/);
  assert.match(component, /\/api\/reports\/subjects\?date=/);
  assert.match(checkpoints, /<ReportSubjectAnalytics date=\{date\} \/>/);
});

void test('subject analytics endpoint is authenticated, bounded to valid dates and validates period', () => {
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /SUBJECT_PERIODS\.includes/);
  assert.match(route, /Майбутня дата недоступна/);
  assert.match(route, /readSubjectAnalytics\(env\.DB, user\.id, date, period as SubjectPeriod\)/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});
