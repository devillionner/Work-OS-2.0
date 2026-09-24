import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bonusRangeFor,
  buildPaymentSummary,
  DEFAULT_PAYMENT_RULES,
  salaryRangeFor,
  validatePaymentRules,
} from '../lib/payments.ts';

test('monthly salary period ends at month boundary and pays on next configured day', () => {
  const range = salaryRangeFor('2026-09-21', {
    ...DEFAULT_PAYMENT_RULES,
    periodMode: 'monthly',
    firstPayDay: 5,
  });
  assert.deepEqual(range, {
    from: '2026-09-01',
    to: '2026-09-30',
    payDate: '2026-10-05',
  });
  assert.equal(
    salaryRangeFor('2026-09-21', { ...DEFAULT_PAYMENT_RULES, firstPayDay: 31 }).payDate,
    '2026-10-31',
  );
});

test('semimonthly salary periods choose the next valid configured payout date', () => {
  const rules = {
    ...DEFAULT_PAYMENT_RULES,
    periodMode: 'semimonthly',
    firstPayDay: 20,
    secondPayDay: 5,
  };
  assert.deepEqual(salaryRangeFor('2026-09-10', rules), {
    from: '2026-09-01',
    to: '2026-09-15',
    payDate: '2026-09-20',
  });
  assert.deepEqual(salaryRangeFor('2026-09-21', rules), {
    from: '2026-09-16',
    to: '2026-09-30',
    payDate: '2026-10-05',
  });
});

test('bonus periods can be configured independently from salary period', () => {
  const salary = salaryRangeFor('2026-09-21', DEFAULT_PAYMENT_RULES);
  assert.deepEqual(bonusRangeFor('2026-09-21', 'weekly', salary), {
    from: '2026-09-21',
    to: '2026-09-27',
    payDate: null,
  });
  assert.deepEqual(bonusRangeFor('2026-09-21', 'monthly', salary), {
    from: '2026-09-01',
    to: '2026-09-30',
    payDate: null,
  });
});

test('payment summary uses configured rates and projects current pace without hardcoded earnings', () => {
  const rules = {
    ...DEFAULT_PAYMENT_RULES,
    baseSalaryCents: 3_000_000,
    leadBonusCents: 10_000,
    leadTarget: 10,
  };
  const salary = salaryRangeFor('2026-09-15', rules);
  const summary = buildPaymentSummary({
    asOf: '2026-09-15',
    rules,
    salaryCountRanges: { leads: salary, bookings: salary, lessons: salary },
    counts: { leads: 5, bookings: 0, lessons: 0 },
  });
  assert.equal(summary.accruedBaseCents, 1_500_000);
  assert.equal(summary.metrics[0].forecast, 10);
  assert.equal(summary.planCents, 3_100_000);
  assert.equal(summary.factCents, 1_550_000);
  assert.equal(summary.forecastCents, 3_100_000);
});

test('payment rules reject unknown or silently normalized values', () => {
  assert.throws(
    () => validatePaymentRules({ ...DEFAULT_PAYMENT_RULES, surprise: true }),
    /невідомий/i,
  );
  assert.throws(
    () => validatePaymentRules({ ...DEFAULT_PAYMENT_RULES, firstPayDay: 99 }),
    /некоректне/i,
  );
});

test('payments API remains owner scoped and settings UI exposes plan fact forecast', async () => {
  const route = await readFile(new URL('../app/api/payments/route.ts', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../components/payment-settings.tsx', import.meta.url), 'utf8');
  assert.match(route, /getCurrentUser/);
  assert.match(route, /sameOrigin/);
  assert.match(route, /WHERE user_id=\?1/);
  assert.match(route, /cancelled_at IS NULL/);
  assert.match(ui, />План</);
  assert.match(ui, />Факт на сьогодні</);
  assert.match(ui, />Прогноз</);
  assert.match(ui, /Період бонусу/);
});
