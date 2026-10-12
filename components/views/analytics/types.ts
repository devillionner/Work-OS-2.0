import type { AnalyticsRankedChat } from '@/lib/analytics-chat-ranking';

export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';
export type MetricKey = 'publications' | 'responses' | 'bookings' | 'completed';
export type SeriesKey = 'joined' | 'publications' | 'responses' | 'bookings' | 'completed';

export type PlatformRow = {
  key: string; name: string; joined: number; publications: number; responses: number; bookings: number; completed: number;
  publicationRate: number; responseRate: number; bookingRate: number; completionRate: number;
};
export type CohortTotals = { leads: number; bookedLeads: number; bookings: number; completed: number; noShow: number; bookingLeadRate: number; completionRate: number; noShowRate: number };
export type CohortPlatform = CohortTotals & { key: string; name: string; platform: string };
export type CohortChat = CohortTotals & { id: string; name: string; platformName: string; platform: string; publications: number; leadRate: number };
export type CohortChatBase = Omit<CohortChat, 'publications' | 'leadRate'>;
export type CohortData = { range: { from: string; to: string }; totals: CohortTotals; platforms: CohortPlatform[]; chats: CohortChatBase[] };
export type TrendPoint = { date: string } & Record<SeriesKey, number>;
export type SubjectRow = { subject: string; responses: number; bookings: number; conversion: number; responseShare: number; bookingShare: number };
export type SubjectData = { from: string; to: string; rows: SubjectRow[]; total: SubjectRow };
export type InsightsData = {
  recommendation: { kind: 'check_low_efficiency' | 'consider_more_often' | 'insufficient_data'; title: string; explanation: string; chatId: string | null; chatName: string | null };
  archiveReasons: Array<{ reason: string; count: number }>;
  archivedChats: number;
};
export type Totals = { joined: number; publications: number; responses: number; bookings: number; completed: number; publicationRate: number; responseRate: number; bookingRate: number; completionRate: number };
export type Targets = { publicationRate: number; responseRate: number; bookingRate: number; completionRate: number };
export type Outcomes = { booked: number; completed: number; cancelled: number; rescheduled: number; noShow: number };

export type AnalyticsData = {
  range: { period: string; days: number; from: string; to: string };
  totals: Totals;
  platforms: PlatformRow[];
  chats: AnalyticsRankedChat[];
  insights: InsightsData;
  trends: TrendPoint[];
  subjects: SubjectData;
  targets: Targets;
  outcomes: Outcomes;
};

export const PERIODS: ReadonlyArray<{ value: AnalyticsPeriod; label: string }> = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'year', label: 'Рік' },
  { value: 'custom', label: 'Довільно' },
];

export const SERIES: ReadonlyArray<{ value: SeriesKey; label: string }> = [
  { value: 'publications', label: 'Публікації' },
  { value: 'joined', label: 'Приєднання' },
  { value: 'responses', label: 'Відгуки' },
  { value: 'bookings', label: 'Записи' },
  { value: 'completed', label: 'Проведені' },
];

export function currentDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Попередній період тієї ж довжини, що закінчується за день до початку поточного (для довільних періодів). */
export function previousRange(from: string, days: number): { from: string; to: string } {
  const to = shiftDate(from, -1);
  return { from: shiftDate(to, -(days - 1)), to };
}

export type PreviousWindow = {
  range: { from: string; to: string; days: number };
  totals: Record<SeriesKey, number>;
  trends: TrendPoint[];
  /** Платформи порівняльного періоду; `null`, якщо відповідь (з кешу) їх не містила. */
  platforms: PlatformRow[] | null;
};
export type ComparisonWindow = { from: string; to: string };

/**
 * З чим порівнювати: календарні періоди — із тими самими днями попереднього (1–11 жовтня проти 1–11 вересня,
 * тиждень з понеділка проти минулого тижня, рік з 1 січня проти минулого року), довільний — з попереднім відрізком тієї ж довжини.
 * Читається лише цей відрізок: підсумок усього минулого місяця не запитується, щоб не збільшувати читання D1.
 */
export function comparisonWindow(period: AnalyticsPeriod, range: AnalyticsData['range']): ComparisonWindow {
  const { from, to, days } = range;
  if (period === 'day') { const day = shiftDate(from, -1); return { from: day, to: day }; }
  if (period === 'week') { const start = shiftDate(from, -7); return { from: start, to: shiftDate(start, days - 1) }; }
  if (period === 'month') {
    const lastDay = shiftDate(from, -1);
    const start = `${lastDay.slice(0, 8)}01`;
    const same = shiftDate(start, Number(to.slice(8, 10)) - 1);
    return { from: start, to: same > lastDay ? lastDay : same };
  }
  if (period === 'year') {
    const year = Number(from.slice(0, 4)) - 1;
    const same = `${year}-${to.slice(5, 10)}`;
    return { from: `${year}-01-01`, to: same === `${year}-02-29` ? `${year}-02-28` : same };
  }
  return previousRange(from, days);
}

/** Відповідь легкого запиту порівняння (`compare=1`): підсумки, тренд і агрегат платформ. */
export type ComparisonData = { range: AnalyticsData['range']; totals: Totals; trends: TrendPoint[]; platforms?: PlatformRow[] };
export function toPreviousWindow(data: ComparisonData): PreviousWindow {
  const { joined, publications, responses, bookings, completed } = data.totals;
  return { range: data.range, totals: { joined, publications, responses, bookings, completed }, trends: data.trends, platforms: data.platforms ?? null };
}

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** «1–11 жовтня» для відрізка в межах одного місяця; для решти — звичайний запис із датами. */
export function humanRange(from: string, to: string): string {
  if (from.slice(0, 7) !== to.slice(0, 7)) return formatRange(from, to);
  const end = DAY_MONTH_FORMAT.format(new Date(`${to}T12:00:00Z`));
  if (from === to) return end;
  return `${Number(from.slice(8, 10))}–${end}`;
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function formatShort(value: string): string {
  const [, month, day] = value.split('-');
  return `${day}.${month}`;
}

export function formatRange(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} — ${formatDate(to)}`;
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  return last === 1 ? one : many;
}

/** Рівномірна вибірка до `limit` елементів; перший і останній лишаються. */
export function sample<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  return Array.from({ length: limit }, (_, index) => items[Math.round((index * (items.length - 1)) / (limit - 1))]);
}
