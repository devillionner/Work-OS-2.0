import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('Analytics archive reasons render localized operator-facing labels', () => {
  const source = readFileSync(new URL('../components/analytics-insights.tsx', import.meta.url), 'utf8');
  assert.match(source, /irrelevant: 'Неактуальний чат'/);
  assert.match(source, /banned: 'Блокування'/);
  assert.match(source, /missing: 'Чат недоступний'/);
  assert.match(source, /other: 'Інше'/);
  assert.match(source, /archiveReasonLabels\[item\.reason\] \?\? 'Інше'/);
  assert.doesNotMatch(source, /<span>\{item\.reason\}<\/span>/);
});
