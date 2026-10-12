import type { CalendarDayContext } from '@/lib/reports/calendar-context';
import type { ReportEventDetail } from '@/lib/reports/details';

export type Report = { id: string; date: string; text: string; submittedAt: number | null; updatedAt: number; revisionCount: number; submissionCount: number; stale: boolean };
export type GoalPlanFact = { dailyTarget: number; dailyActual: number; monthlyTarget: number; monthlyActual: number };
export type ReportData = {
  month: string;
  reports: Report[];
  calendarContext: CalendarDayContext[];
  selected: Report | null;
  suggestedText: string;
  /** Чотири рядки «Ціль по … за день: факт/ціль» для вибраного дня. */
  goalLines: string[];
  summary: Array<{ platform: string; eventType: string; count: number }>;
  details: ReportEventDetail[];
  previousReportReminder: { date: string; pending: boolean };
  finalReportState: { canSubmit: boolean; reason: string | null } | null;
  goalPlanFact: GoalPlanFact | null;
  leadCommandScope: string;
};

export type DayFilter = 'all' | 'has-report' | 'missing' | 'stale' | 'resubmitted';
export const DAY_FILTERS: ReadonlyArray<{ value: DayFilter; label: string }> = [
  { value: 'all', label: 'Усі' },
  { value: 'has-report', label: 'Є звіт' },
  { value: 'missing', label: 'Немає' },
  { value: 'stale', label: 'Застарілий' },
  { value: 'resubmitted', label: 'Здано повторно' },
];

export function matchesFilter(filter: DayFilter, report: Report | undefined): boolean {
  if (filter === 'all') return true;
  if (filter === 'has-report') return Boolean(report);
  if (filter === 'missing') return !report;
  if (filter === 'stale') return Boolean(report?.stale);
  return Boolean(report?.submittedAt && report.submissionCount >= 2);
}

export function currentDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function monthDates(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

export function shiftDay(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Той самий день у сусідньому місяці; якщо такого числа немає — останній день місяця. */
export function shiftMonthDate(value: string, offset: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 7)}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1))).replace(/^./, (value) => value.toUpperCase());
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function formatDateLong(value: string): string {
  const text = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function weekday(value: string): string {
  return ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(`${value}T12:00:00Z`).getUTCDay()];
}

export function formatStamp(epochSeconds: number): string {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(epochSeconds * 1000));
}

export function formatClock(epochSeconds: number): string {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(epochSeconds * 1000));
}
