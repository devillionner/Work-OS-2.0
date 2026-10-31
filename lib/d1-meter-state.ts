// Лічильник прочитаних рядків D1 за добу (3.8.0). Чиста логіка без доступу до D1: її використовують і воркер
// (workers/d1-meter.js: накопичення й запобіжник), і Durable Object (workers/owner-channel.js: денні суми), і маршрут
// статистики. Ліміт акаунта — 5 млн прочитаних рядків за добу, при перевищенні сайт лягає.

/** Ім'я екземпляра Durable Object, що веде денний підсумок (окремий від каналів власників). */
export const D1_METER_NAME = 'd1-meter';
/** Від цієї кількості за добу власнику йде одне сповіщення. */
export const D1_WARN_ROWS = 1_000_000;
/** Від цієї кількості важкі необов'язкові читання відповідають «економимо ліміт». */
export const D1_STOP_ROWS = 1_500_000;
/** Скільки різних маршрутів тримаємо в підсумку; решта зливається в «інше». */
const MAX_ROUTES = 60;
export const D1_BUDGET_TEXT = 'Зараз економимо ліміт бази, спробуй завтра.';

export type MeterData = { day: string; total: number; routes: Record<string, number>; warned: boolean };
export type MeterAdd = { total: number; routes: Record<string, number> };
export type MeterLevel = 'ok' | 'warn' | 'stop';
export type MeterStatus = { day: string; total: number; level: MeterLevel; top: Array<{ route: string; rows: number }> };

/** Доба рахується за UTC: о 00:00 UTC Cloudflare скидає денний ліміт. */
export function meterDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function emptyMeter(day: string): MeterData {
  return { day, total: 0, routes: {}, warned: false };
}

export function meterLevel(total: number): MeterLevel {
  if (total >= D1_STOP_ROWS) return 'stop';
  if (total >= D1_WARN_ROWS) return 'warn';
  return 'ok';
}

/** Додає внесок воркера до денного підсумку; нова доба починає з нуля. */
export function addToMeter(current: MeterData | null, add: MeterAdd, now: number): MeterData {
  const day = meterDay(now);
  const data: MeterData = current && current.day === day ? { ...current, routes: { ...current.routes } } : emptyMeter(day);
  const rows = Math.max(0, Math.floor(Number(add.total) || 0));
  data.total += rows;
  for (const [route, value] of Object.entries(add.routes || {})) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (!count) continue;
    const key = route.slice(0, 120);
    data.routes[key] = (data.routes[key] ?? 0) + count;
  }
  const keys = Object.keys(data.routes);
  if (keys.length > MAX_ROUTES) {
    const sorted = keys.sort((a, b) => data.routes[b] - data.routes[a]);
    const rest = sorted.slice(MAX_ROUTES - 1);
    const merged = rest.reduce((sum, key) => sum + data.routes[key], 0);
    for (const key of rest) delete data.routes[key];
    data.routes['інше'] = (data.routes['інше'] ?? 0) + merged;
  }
  return data;
}

export function topRoutes(data: MeterData, count = 3): Array<{ route: string; rows: number }> {
  return Object.entries(data.routes).sort((a, b) => b[1] - a[1]).slice(0, count).map(([route, rows]) => ({ route, rows }));
}

export function meterStatus(data: MeterData): MeterStatus {
  return { day: data.day, total: data.total, level: meterLevel(data.total), top: topRoutes(data, 5) };
}

/** Читання, без яких застосунок працює: аналітика, сканування дублікатів, плани. Чати, автопост і ліди сюди не входять. */
export function isHeavyRoute(method: string, pathname: string, params: URLSearchParams): boolean {
  if (method !== 'GET') return false;
  if (pathname === '/api/analytics' || pathname.startsWith('/api/analytics/')) return true;
  if (pathname === '/api/chats/duplicates') return true;
  if (pathname === '/api/leads/maintenance') return true;
  if (pathname === '/api/reports/subjects') return true;
  if (pathname === '/api/messenger-automation' && params.has('plan')) return true;
  return false;
}

/** «1 234 567» → «1,2 млн», «34 000» → «34 тис.» для короткого тексту в інтерфейсі й сповіщенні. */
export function formatRows(rows: number): string {
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(1).replace('.', ',')} млн`;
  if (rows >= 1_000) return `${Math.round(rows / 1_000)} тис.`;
  return String(rows);
}

const SUSPEND_KEY = '__workOsD1MeterSuspended';

/** Чи зараз читання не рахуються (воркер і Durable Object зібрані окремо, тож лічильник пауз спільний через globalThis). */
export function meterSuspended(): boolean {
  return Number((globalThis as Record<string, unknown>)[SUSPEND_KEY] ?? 0) > 0;
}

/** Виконує `work` без обліку: читання самого лічильника не повинні рахуватися й викликати його знову. */
export async function unmetered<T>(work: () => Promise<T>): Promise<T> {
  const holder = globalThis as Record<string, unknown>;
  holder[SUSPEND_KEY] = Number(holder[SUSPEND_KEY] ?? 0) + 1;
  try { return await work(); } finally { holder[SUSPEND_KEY] = Number(holder[SUSPEND_KEY] ?? 1) - 1; }
}
