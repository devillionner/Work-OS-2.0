import { shiftBusinessDate } from './business-time.ts';

export type PaymentPeriodMode = 'monthly' | 'semimonthly';
export type BonusPeriodMode = 'salary' | 'monthly' | 'weekly';
export type PaymentMetric = 'leads' | 'bookings' | 'lessons';

export type PaymentRules = {
  periodMode: PaymentPeriodMode;
  firstPayDay: number;
  secondPayDay: number;
  baseSalaryCents: number;
  leadBonusCents: number;
  bookingBonusCents: number;
  lessonBonusCents: number;
  leadTarget: number;
  bookingTarget: number;
  lessonTarget: number;
  leadBonusPeriod: BonusPeriodMode;
  bookingBonusPeriod: BonusPeriodMode;
  lessonBonusPeriod: BonusPeriodMode;
};

export type DateRange = {
  from: string;
  to: string;
  payDate: string | null;
};

export type PaymentMetricSummary = {
  metric: PaymentMetric;
  range: DateRange;
  actual: number;
  target: number;
  forecast: number;
  rateCents: number;
  actualBonusCents: number;
  planBonusCents: number;
  forecastBonusCents: number;
};

export type PaymentSummary = {
  asOf: string;
  salaryRange: DateRange;
  progress: { elapsedDays: number; totalDays: number };
  metrics: PaymentMetricSummary[];
  planCents: number;
  factCents: number;
  forecastCents: number;
  accruedBaseCents: number;
};

export const DEFAULT_PAYMENT_RULES: PaymentRules = {
  periodMode: 'monthly',
  firstPayDay: 5,
  secondPayDay: 20,
  baseSalaryCents: 0,
  leadBonusCents: 0,
  bookingBonusCents: 0,
  lessonBonusCents: 0,
  leadTarget: 0,
  bookingTarget: 0,
  lessonTarget: 0,
  leadBonusPeriod: 'salary',
  bookingBonusPeriod: 'salary',
  lessonBonusPeriod: 'salary',
};

const MAX_MONEY_CENTS = 100_000_000;
const MAX_TARGET = 1_000_000;

export function normalizePaymentRules(value: unknown): PaymentRules {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    periodMode: enumValue(raw.periodMode, ['monthly', 'semimonthly'], DEFAULT_PAYMENT_RULES.periodMode),
    firstPayDay: boundedInteger(raw.firstPayDay, 1, 31, DEFAULT_PAYMENT_RULES.firstPayDay),
    secondPayDay: boundedInteger(raw.secondPayDay, 1, 31, DEFAULT_PAYMENT_RULES.secondPayDay),
    baseSalaryCents: boundedInteger(raw.baseSalaryCents, 0, MAX_MONEY_CENTS, 0),
    leadBonusCents: boundedInteger(raw.leadBonusCents, 0, MAX_MONEY_CENTS, 0),
    bookingBonusCents: boundedInteger(raw.bookingBonusCents, 0, MAX_MONEY_CENTS, 0),
    lessonBonusCents: boundedInteger(raw.lessonBonusCents, 0, MAX_MONEY_CENTS, 0),
    leadTarget: boundedInteger(raw.leadTarget, 0, MAX_TARGET, 0),
    bookingTarget: boundedInteger(raw.bookingTarget, 0, MAX_TARGET, 0),
    lessonTarget: boundedInteger(raw.lessonTarget, 0, MAX_TARGET, 0),
    leadBonusPeriod: enumValue(raw.leadBonusPeriod, ['salary', 'monthly', 'weekly'], 'salary'),
    bookingBonusPeriod: enumValue(raw.bookingBonusPeriod, ['salary', 'monthly', 'weekly'], 'salary'),
    lessonBonusPeriod: enumValue(raw.lessonBonusPeriod, ['salary', 'monthly', 'weekly'], 'salary'),
  };
}

export function validatePaymentRules(value: unknown): PaymentRules {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Некоректні правила виплат.');
  const raw = value as Record<string, unknown>;
  const required = Object.keys(DEFAULT_PAYMENT_RULES);
  if (Object.keys(raw).some((key) => !required.includes(key)))
    throw new Error('Є невідомий параметр виплат.');
  for (const key of required) {
    if (!(key in raw)) throw new Error('Заповни всі правила виплат.');
  }
  const rules = normalizePaymentRules(raw);
  for (const key of required) {
    if (rules[key as keyof PaymentRules] !== raw[key])
      throw new Error('Некоректне значення у правилах виплат.');
  }
  return rules;
}

export function salaryRangeFor(asOf: string, rules: PaymentRules): DateRange {
  const [year, month, day] = dateParts(asOf);
  const last = daysInMonth(year, month);
  if (rules.periodMode === 'semimonthly' && day <= 15) {
    const to = formatDate(year, month, 15);
    return { from: formatDate(year, month, 1), to, payDate: nextPayDate(to, rules.firstPayDay) };
  }
  const fromDay = rules.periodMode === 'semimonthly' ? 16 : 1;
  const to = formatDate(year, month, last);
  return {
    from: formatDate(year, month, fromDay),
    to,
    payDate: nextPayDate(to, rules.periodMode === 'semimonthly' ? rules.secondPayDay : rules.firstPayDay),
  };
}

export function bonusRangeFor(asOf: string, mode: BonusPeriodMode, salaryRange: DateRange): DateRange {
  if (mode === 'salary') return { ...salaryRange, payDate: salaryRange.payDate };
  const [year, month] = dateParts(asOf);
  if (mode === 'monthly') {
    return { from: formatDate(year, month, 1), to: formatDate(year, month, daysInMonth(year, month)), payDate: null };
  }
  const isoDay = isoWeekday(asOf);
  return {
    from: shiftBusinessDate(asOf, -(isoDay - 1)),
    to: shiftBusinessDate(asOf, 7 - isoDay),
    payDate: null,
  };
}

export function buildPaymentSummary(input: {
  asOf: string;
  rules: PaymentRules;
  salaryCountRanges: Record<PaymentMetric, DateRange>;
  counts: Record<PaymentMetric, number>;
}): PaymentSummary {
  const salaryRange = salaryRangeFor(input.asOf, input.rules);
  const elapsedDays = inclusiveDays(salaryRange.from, input.asOf);
  const totalDays = inclusiveDays(salaryRange.from, salaryRange.to);
  const accruedBaseCents = Math.round(input.rules.baseSalaryCents * Math.min(1, elapsedDays / totalDays));
  const metrics: PaymentMetricSummary[] = (['leads', 'bookings', 'lessons'] as PaymentMetric[]).map((metric) => {
    const range = input.salaryCountRanges[metric];
    const actual = Math.max(0, Math.floor(input.counts[metric] || 0));
    const target = targetFor(input.rules, metric);
    const rateCents = rateFor(input.rules, metric);
    const rangeElapsed = inclusiveDays(range.from, input.asOf);
    const rangeTotal = inclusiveDays(range.from, range.to);
    const forecast = rangeElapsed > 0
      ? Math.max(actual, Math.round(actual * rangeTotal / rangeElapsed))
      : actual;
    return {
      metric,
      range,
      actual,
      target,
      forecast,
      rateCents,
      actualBonusCents: actual * rateCents,
      planBonusCents: target * rateCents,
      forecastBonusCents: forecast * rateCents,
    };
  });
  return {
    asOf: input.asOf,
    salaryRange,
    progress: { elapsedDays, totalDays },
    metrics,
    planCents: input.rules.baseSalaryCents + sum(metrics.map((item) => item.planBonusCents)),
    factCents: accruedBaseCents + sum(metrics.map((item) => item.actualBonusCents)),
    forecastCents: input.rules.baseSalaryCents + sum(metrics.map((item) => item.forecastBonusCents)),
    accruedBaseCents,
  };
}

function targetFor(rules: PaymentRules, metric: PaymentMetric) {
  return metric === 'leads' ? rules.leadTarget : metric === 'bookings' ? rules.bookingTarget : rules.lessonTarget;
}

function rateFor(rules: PaymentRules, metric: PaymentMetric) {
  return metric === 'leads' ? rules.leadBonusCents : metric === 'bookings' ? rules.bookingBonusCents : rules.lessonBonusCents;
}

function nextPayDate(periodEnd: string, configuredDay: number): string {
  let [year, month] = dateParts(periodEnd);
  const sameMonth = formatDate(
    year,
    month,
    Math.min(configuredDay, daysInMonth(year, month)),
  );
  if (sameMonth > periodEnd) return sameMonth;
  month += 1;
  if (month === 13) { year += 1; month = 1; }
  return formatDate(year, month, Math.min(configuredDay, daysInMonth(year, month)));
}

function dateParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Некоректна дата виплат.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    throw new Error('Некоректна дата виплат.');
  return [year, month, day];
}

function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new Error('Некоректний період виплат.');
  return Math.floor((end - start) / 86_400_000) + 1;
}

function isoWeekday(value: string): number {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
