import { keyedCacheRequest, matchRevisionJson, putRevisionJson } from './revision-cache.ts';

/**
 * Версія подій періоду: скільки днів мають рахункові події й сума їхніх ревізій (`activity_day_revisions`, міграція 0029,
 * зростає від кожної події, що рахується в аналітиці). Глобальна ревізія росте від будь-якого запису (автопост, стан чатів),
 * тож кеш за нею скидався постійно; ця версія змінюється лише тоді, коли в періоді з'явилась, зникла чи скасувалась подія.
 * Період продовжено до сьогодні: записи «заднім числом» і результати уроків пізніших за період дат теж змінюють ключ.
 * Коштує стільки читань, скільки днів з подіями в періоді (місяць ≈ 30).
 */
export async function readAnalyticsRangeVersion(db: D1Database, userId: string, from: string, to: string, today: string): Promise<string> {
  const end = to > today ? to : today;
  const row = await db.prepare(`SELECT COUNT(*) AS days,COALESCE(SUM(revision),0) AS total
    FROM activity_day_revisions WHERE user_id=?1 AND event_date>=?2 AND event_date<=?3`)
    .bind(userId, from, end).first<{ days: number; total: number }>();
  return `${Number(row?.days || 0)}:${Number(row?.total || 0)}`;
}

/**
 * Важкий розрахунок аналітики за період: береться з кешу, поки версія подій періоду та ключ не змінились, інакше рахується заново.
 * `ttlSeconds` обмежує, як довго можуть лишатися старими дані, що не залежать від подій (назва чату, його статус, профіль).
 */
export async function cachedAnalytics<T>(input: {
  userId: string; namespace: string; key: string; version: string; ttlSeconds: number; compute: () => Promise<T>;
}): Promise<T> {
  const request = await keyedCacheRequest(input.userId, `analytics-${input.namespace}`, `${input.key}:${input.version}`);
  const cached = await matchRevisionJson(request);
  if (cached) {
    try { return await cached.json() as T; } catch { /* пошкоджений запис кешу рахуємо заново */ }
  }
  const value = await input.compute();
  await putRevisionJson(request, value, input.ttlSeconds);
  return value;
}
