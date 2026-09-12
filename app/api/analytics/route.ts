import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement } from '@/lib/activity-summary';
import { completedOperatorLessonsStatement } from '@/lib/analytics-attribution';

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#2563eb' },
  whatsapp: { name: 'WhatsApp', color: '#16a34a' },
  viber: { name: 'Viber', color: '#7c3aed' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  threads: { name: 'Threads', color: '#17191e' },
};

type EventAggregate = { platform: string | null; event_type: string; count: number };
type PlatformRow = {
  key: string; name: string; color: string; publications: number; responses: number;
  bookings: number; completed: number; responseRate: number; bookingRate: number; completionRate: number;
};

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get('range') || 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const to = kyivDate();
  const from = shiftDate(to, -(days - 1));

  const [eventsResult, lessonsResult, chatResult] = await env.DB.batch([
    activitySummaryStatement(env.DB, user.id, from, to),
    completedOperatorLessonsStatement(env.DB, user.id, from, to),
    env.DB.prepare(`SELECT COALESCE(e.chat_id,l.source_chat_id) AS chat_id,c.name,c.platform,
        SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
        SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
        SUM(CASE WHEN e.event_type IN ('lesson_booked','curator_booking_pending') THEN 1 ELSE 0 END) AS bookings
      FROM activity_events e
      LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
      WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
        AND COALESCE(e.chat_id,l.source_chat_id) IS NOT NULL
      GROUP BY COALESCE(e.chat_id,l.source_chat_id),c.name,c.platform
      HAVING publications>0 OR responses>0 OR bookings>0
      ORDER BY publications DESC,responses DESC,bookings DESC,c.name ASC LIMIT 100`).bind(user.id, from, to),
  ]);

  const eventRows = eventsResult.results as EventAggregate[];
  const completedRows = lessonsResult.results as Array<{ platform: string; count: number }>;
  const completedByPlatform = new Map(completedRows.map((row) => [row.platform, Number(row.count || 0)]));
  const totals = { publications: 0, responses: 0, bookings: 0, completed: 0 };
  const byPlatform = new Map<string, { publications: number; responses: number; bookings: number }>();
  for (const row of eventRows) {
    const key = row.platform || 'unknown';
    const current = byPlatform.get(key) || { publications: 0, responses: 0, bookings: 0 };
    if (row.event_type === 'publication') current.publications += Number(row.count || 0);
    if (row.event_type === 'lead_created') current.responses += Number(row.count || 0);
    if (row.event_type === 'lesson_booked' || row.event_type === 'curator_booking_pending') current.bookings += Number(row.count || 0);
    byPlatform.set(key, current);
  }
  const platformKeys = new Set([...byPlatform.keys(), ...completedByPlatform.keys()]);
  totals.publications = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.publications, 0);
  totals.responses = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.responses, 0);
  totals.bookings = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.bookings, 0);
  totals.completed = Array.from(completedByPlatform.values()).reduce((sum, count) => sum + count, 0);
  const platforms: PlatformRow[] = Array.from(platformKeys)
    .filter((key) => key !== 'unknown')
    .map((key) => {
      const values = byPlatform.get(key) || { publications: 0, responses: 0, bookings: 0 };
      const completed = completedByPlatform.get(key) || 0;
      return {
        key,
        name: PLATFORM_META[key]?.name || key,
        color: PLATFORM_META[key]?.color || '#6b7280',
        ...values,
        completed,
        responseRate: rate(values.responses, values.publications),
        bookingRate: rate(values.bookings, values.responses),
        completionRate: rate(completed, values.bookings),
      };
    })
    .sort((a, b) => b.publications - a.publications || a.name.localeCompare(b.name, 'uk'));

  const chats = (chatResult.results as Array<{ chat_id: string; name: string | null; platform: string | null; publications: number; responses: number; bookings: number }>).map((row) => ({
    id: row.chat_id,
    name: row.name || 'Без назви',
    platform: row.platform || 'unknown',
    platformName: PLATFORM_META[row.platform || '']?.name || row.platform || 'Інше',
    publications: Number(row.publications || 0),
    responses: Number(row.responses || 0),
    bookings: Number(row.bookings || 0),
    responseRate: rate(Number(row.responses || 0), Number(row.publications || 0)),
    bookingRate: rate(Number(row.bookings || 0), Number(row.responses || 0)),
  }));

  return Response.json({
    range: { days, from, to },
    totals: {
      ...totals,
      responseRate: rate(totals.responses, totals.publications),
      bookingRate: rate(totals.bookings, totals.responses),
      completionRate: rate(totals.completed, totals.bookings),
    },
    platforms,
    chats,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function rate(value: number, base: number): number {
  return base > 0 ? Math.round((value / base) * 1000) / 10 : 0;
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
