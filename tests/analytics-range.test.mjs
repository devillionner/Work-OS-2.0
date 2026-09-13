import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnalyticsRange } from '../lib/analytics-range.ts';

const TODAY = '2026-09-13';

void test('analytics presets resolve Kyiv calendar day, week, month and year', () => {
  assert.deepEqual(resolveAnalyticsRange(new URLSearchParams('period=day'), TODAY), {
    period: 'day', from: TODAY, to: TODAY, days: 1,
  });
  assert.deepEqual(resolveAnalyticsRange(new URLSearchParams('period=week'), TODAY), {
    period: 'week', from: '2026-09-07', to: TODAY, days: 7,
  });
  assert.deepEqual(resolveAnalyticsRange(new URLSearchParams('period=month'), TODAY), {
    period: 'month', from: '2026-09-01', to: TODAY, days: 13,
  });
  assert.deepEqual(resolveAnalyticsRange(new URLSearchParams('period=year'), TODAY), {
    period: 'year', from: '2026-01-01', to: TODAY, days: 256,
  });
});

void test('custom analytics range accepts historical dates and preserves legacy rolling ranges', () => {
  assert.deepEqual(
    resolveAnalyticsRange(new URLSearchParams('period=custom&from=2026-08-20&to=2026-09-05'), TODAY),
    { period: 'custom', from: '2026-08-20', to: '2026-09-05', days: 17 },
  );
  assert.deepEqual(
    resolveAnalyticsRange(new URLSearchParams('range=30'), '2026-09-10'),
    { period: 'rolling', from: '2026-08-12', to: '2026-09-10', days: 30 },
  );
});

void test('analytics range rejects malformed, reversed, future and excessive custom ranges', () => {
  for (const query of [
    'period=wat',
    'period=custom&from=2026-02-30&to=2026-09-01',
    'period=custom&from=2026-09-02&to=2026-09-01',
    'period=custom&from=2026-09-01&to=2026-09-14',
    'period=custom&from=2010-01-01&to=2026-09-01',
  ]) {
    assert.throws(() => resolveAnalyticsRange(new URLSearchParams(query), TODAY));
  }
});
