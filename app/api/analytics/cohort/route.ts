import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readAnalyticsCohort } from '@/lib/analytics-cohort';
import { resolveAnalyticsRange } from '@/lib/analytics-range';
import { revisionCacheRequest, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';

const PLATFORM_NAMES: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook', threads: 'Threads' };

// Когорти окремо від основної аналітики: екран вантажить їх, лише коли картка потрапила в в'юпорт.
// Публікації й відсоток відгуків по чату клієнт бере з рейтингу чатів основного запиту, тож тут їх немає.
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  let range;
  try {
    range = resolveAnalyticsRange(new URL(request.url).searchParams, kyivDate());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Некоректний період аналітики.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const { from, to } = range;
  const cacheRequest = await revisionCacheRequest(env.DB, user.id, 'analytics-cohort', `${from}:${to}`);
  const cached = await matchRevisionJson(cacheRequest);
  if (cached) return cached;

  const cohort = await readAnalyticsCohort(env.DB, user.id, from, to);
  const payload = {
    range,
    totals: {
      ...cohort.totals,
      bookingLeadRate: rate(cohort.totals.bookedLeads, cohort.totals.leads),
      completionRate: rate(cohort.totals.completed, cohort.totals.bookings),
      noShowRate: rate(cohort.totals.noShow, cohort.totals.bookings),
    },
    platforms: cohort.platforms.map((row) => ({
      key: row.platform,
      name: PLATFORM_NAMES[row.platform] || row.platform,
      ...row,
      bookingLeadRate: rate(row.bookedLeads, row.leads),
      completionRate: rate(row.completed, row.bookings),
      noShowRate: rate(row.noShow, row.bookings),
    })),
    chats: cohort.chats.map((row) => ({
      ...row,
      platformName: PLATFORM_NAMES[row.platform] || row.platform,
      bookingLeadRate: rate(row.bookedLeads, row.leads),
      completionRate: rate(row.completed, row.bookings),
      noShowRate: rate(row.noShow, row.bookings),
    })),
  };
  await putRevisionJson(cacheRequest, payload, 600);
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store', 'X-Work-OS-Cache': 'MISS' } });
}

function rate(value: number, base: number): number {
  return base > 0 ? Math.round((value / base) * 1000) / 10 : 0;
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
