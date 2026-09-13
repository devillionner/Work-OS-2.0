export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'year' | 'custom' | 'rolling';

export type AnalyticsRange = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  days: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 3660;

export function resolveAnalyticsRange(params: URLSearchParams, today: string): AnalyticsRange {
  if (!validDate(today)) throw new Error('Некоректна поточна дата.');

  const legacyDays = Number(params.get('range'));
  if (!params.has('period') && [7, 30, 90].includes(legacyDays)) {
    const from = shiftDate(today, -(legacyDays - 1));
    return { period: 'rolling', from, to: today, days: legacyDays };
  }

  const requested = params.get('period') || 'month';
  if (!['day', 'week', 'month', 'year', 'custom'].includes(requested)) {
    throw new Error('Некоректний період аналітики.');
  }

  let from: string;
  let to = today;
  if (requested === 'day') {
    from = today;
  } else if (requested === 'week') {
    from = startOfWeek(today);
  } else if (requested === 'month') {
    from = `${today.slice(0, 7)}-01`;
  } else if (requested === 'year') {
    from = `${today.slice(0, 4)}-01-01`;
  } else {
    const customFrom = params.get('from') || '';
    const customTo = params.get('to') || '';
    if (!validDate(customFrom) || !validDate(customTo)) {
      throw new Error('Для довільного періоду вкажіть коректні дати від і до.');
    }
    from = customFrom;
    to = customTo;
  }

  if (from > to) throw new Error('Початок періоду не може бути пізніше завершення.');
  if (to > today) throw new Error('Аналітика майбутніх дат недоступна.');
  const days = inclusiveDays(from, to);
  if (days > MAX_RANGE_DAYS) throw new Error('Період аналітики завеликий. Максимум — 10 років.');
  return { period: requested as Exclude<AnalyticsPeriod, 'rolling'>, from, to, days };
}

export function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function startOfWeek(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return shiftDate(value, -offset);
}

function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
