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


void test('Analytics exposes complete per-chat attribution labels and conversions', () => {
  const source = readFileSync(new URL('../components/analytics-workspace.tsx', import.meta.url), 'utf8');
  for (const label of ['Публікації', 'Унікальні відгуки', 'Ліди із записом', 'Усі записи', 'Проведені / неявки', 'Конверсії'])
    assert.match(source, new RegExp(label));
  for (const conversion of ['Відгук / публ.', 'Запис / відгук', 'Проведено / запис', 'Неявка / запис'])
    assert.ok(source.includes(conversion));
  assert.match(source, /Пізні повторні записи лишаються за початковим чатом-джерелом/);
});


void test('Analytics subject conversion uses dash when there is no response denominator', () => {
  const source = readFileSync(new URL('../components/analytics-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /percentLabel\(data\.total\.conversion, data\.total\.responses\)/);
  assert.match(source, /percentLabel\(row\.conversion, row\.responses\)/);
  assert.match(source, /denominator > 0 \? .* : '—'/);
});
