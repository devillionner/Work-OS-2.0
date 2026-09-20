import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/reports-workspace.tsx', import.meta.url), 'utf8');

void test('report calendar exposes explicit status filters without flattening the calendar grid', () => {
  for (const label of ['Є звіт','Немає','Застарілий','Здано повторно']) assert.match(source,new RegExp(label));
  assert.match(source,/<fieldset className="reports-calendar-filters" aria-label="Фільтр календаря">/);
  assert.match(source,/submissionCount >= 2/);
  assert.match(source,/is-filtered-out/);
  assert.doesNotMatch(source,/aria-hidden=\{!matches\}/);
});
