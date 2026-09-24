import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsPercentLabel } from '../lib/analytics-rate.ts';

void test('analytics percent label uses dash for an undefined rate', () => {
  assert.equal(analyticsPercentLabel(0, 0), '—');
});

void test('analytics percent label preserves event rates above 100 percent', () => {
  assert.equal(analyticsPercentLabel(125, 4), '125%');
});
