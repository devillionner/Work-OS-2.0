// Лічильник звернень до Durable Objects за добу (3.12.0). Чиста логіка без доступу до сховища: її використовують Durable Object
// (workers/owner-channel.js: накопичення й запис у ctx.storage) і маршрут статистики. Ліміт безкоштовного плану — 100 тис. запитів на добу.

/** Ключ у ctx.storage кожного екземпляра Durable Object. */
export const DO_USAGE_KEY = 'do_usage';
export const DO_USAGE_LIMIT = 100_000;
/** Від цієї кількості запитів за добу власнику йде одне сповіщення й вмикається режим економії. */
export const DO_USAGE_WARN = 70_000;
/** Cloudflare рахує вхідні повідомлення WebSocket як 1/20 запиту, решту (fetch, будильник, RPC) — по одному. */
export const DO_WS_BILLING_RATIO = 20;
/** Скільки різних видів звернень тримаємо; решта зливається в «інше». */
const MAX_KINDS = 60;

export type DoUsage = { day: string; kinds: Record<string, number>; warned: boolean; economy: boolean };
export type DoUsageStatus = { day: string; requests: number; limit: number; economy: boolean; top: Array<{ kind: string; count: number; requests: number }> };

export function usageDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function emptyUsage(day: string): DoUsage {
  return { day, kinds: {}, warned: false, economy: false };
}

/** Скільки запитів до ліміту дає `count` звернень цього виду. */
export function billedRequests(kind: string, count: number): number {
  return kind.startsWith('ws:') ? count / DO_WS_BILLING_RATIO : count;
}

export function totalRequests(kinds: Record<string, number>): number {
  return Object.entries(kinds).reduce((sum, [kind, count]) => sum + billedRequests(kind, count), 0);
}

/** Додає звернення до добового підсумку; нова доба починає з нуля (доба за UTC: о 00:00 UTC Cloudflare скидає ліміт). */
export function addUsage(current: DoUsage | null | undefined, kinds: Record<string, number>, day: string): DoUsage {
  const data: DoUsage = current && current.day === day ? { ...current, kinds: { ...current.kinds } } : emptyUsage(day);
  for (const [kind, value] of Object.entries(kinds)) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (!count) continue;
    const key = kind.slice(0, 80);
    data.kinds[key] = (data.kinds[key] ?? 0) + count;
  }
  const keys = Object.keys(data.kinds);
  if (keys.length > MAX_KINDS) {
    const sorted = keys.sort((a, b) => billedRequests(b, data.kinds[b]) - billedRequests(a, data.kinds[a]));
    const rest = sorted.slice(MAX_KINDS - 1);
    const merged = rest.reduce((sum, key) => sum + data.kinds[key], 0);
    for (const key of rest) delete data.kinds[key];
    data.kinds['інше'] = (data.kinds['інше'] ?? 0) + merged;
  }
  return data;
}

/** Складає підсумки кількох екземплярів (канал власника й лічильник бази) в один. */
export function mergeUsage(parts: Array<DoUsage | null | undefined>, day: string): DoUsage {
  let merged = emptyUsage(day);
  for (const part of parts) {
    if (!part || part.day !== day) continue;
    merged = addUsage(merged, part.kinds, day);
    merged.economy = merged.economy || part.economy;
    merged.warned = merged.warned || part.warned;
  }
  return merged;
}

export function usageStatus(data: DoUsage, topCount = 6): DoUsageStatus {
  const top = Object.entries(data.kinds)
    .map(([kind, count]) => ({ kind, count, requests: Math.round(billedRequests(kind, count)) }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, topCount);
  return { day: data.day, requests: Math.round(totalRequests(data.kinds)), limit: DO_USAGE_LIMIT, economy: data.economy, top };
}

/** Короткий підпис виду звернення для інтерфейсу й сповіщення. */
export function usageKindLabel(kind: string): string {
  if (kind === 'alarm') return 'будильники';
  if (kind.startsWith('fetch:')) return `запит ${kind.slice(6)}`;
  if (kind.startsWith('ws:')) return `повідомлення ${kind.slice(3)}`;
  return kind;
}
