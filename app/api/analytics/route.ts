import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement } from '@/lib/activity-summary';
import { completedOperatorLessonsStatement } from '@/lib/analytics-attribution';
import { readAnalyticsCohort } from '@/lib/analytics-cohort';
import { analyticsCsv, type AnalyticsExportData } from '@/lib/analytics-export';
import { buildAnalyticsRecommendation } from '@/lib/analytics-insights';
import { resolveAnalyticsRange } from '@/lib/analytics-range';
import { readAnalyticsTrends } from '@/lib/analytics-trends';
import { businessDayStart, shiftBusinessDate } from '@/lib/business-time';
import { readSubjectAnalyticsRange } from '@/lib/reports/subjects';

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#2563eb' },
  whatsapp: { name: 'WhatsApp', color: '#16a34a' },
  viber: { name: 'Viber', color: '#7c3aed' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  threads: { name: 'Threads', color: '#17191e' },
};

type EventAggregate = { platform: string | null; event_type: string; count: number };
type FunnelCounts = { joined: number; publications: number; responses: number; bookings: number };
type PlatformRow = FunnelCounts & {
  key: string; name: string; color: string; completed: number; publicationRate: number;
  responseRate: number; bookingRate: number; completionRate: number;
};
type ArchiveReasonRow = { reason: string; count: number };

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  const url = new URL(request.url);
  let range;
  try {
    range = resolveAnalyticsRange(url.searchParams, kyivDate());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Некоректний період аналітики.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { from, to } = range;
  const archiveFrom = businessDayStart(from);
  const archiveTo = businessDayStart(shiftBusinessDate(to, 1));

  const [cohort, trends, subjects, batch] = await Promise.all([
    readAnalyticsCohort(env.DB, user.id, from, to),
    readAnalyticsTrends(env.DB, user.id, from, to),
    readSubjectAnalyticsRange(env.DB, user.id, from, to),
    env.DB.batch([
      activitySummaryStatement(env.DB, user.id, from, to),
      completedOperatorLessonsStatement(env.DB, user.id, from, to),
      env.DB.prepare(`SELECT COALESCE(e.chat_id,l.source_chat_id) AS chat_id,c.name,c.platform,c.workflow_status,
          pr.language,pr.directions_json,
          SUM(CASE WHEN e.event_type='chat_joined' THEN 1 ELSE 0 END) AS joined,
          SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
          SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
          SUM(CASE WHEN e.event_type IN ('lesson_booked','curator_booking_pending') THEN 1 ELSE 0 END) AS bookings
        FROM activity_events e
        LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
        LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
        LEFT JOIN chat_profiles pr ON pr.chat_id=c.id
        WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
          AND COALESCE(e.chat_id,l.source_chat_id) IS NOT NULL
        GROUP BY COALESCE(e.chat_id,l.source_chat_id),c.name,c.platform,c.workflow_status,pr.language,pr.directions_json
        HAVING joined>0 OR publications>0 OR responses>0 OR bookings>0
        ORDER BY publications DESC,responses DESC,bookings DESC,joined DESC,c.name ASC LIMIT 100`).bind(user.id, from, to),
      env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(archive_reason),''),'Без причини') AS reason,COUNT(*) AS count
        FROM chats WHERE user_id=?1 AND workflow_status='archived' AND archived_at>=?2 AND archived_at<?3
        GROUP BY COALESCE(NULLIF(TRIM(archive_reason),''),'Без причини')
        ORDER BY count DESC,reason ASC LIMIT 20`).bind(user.id, archiveFrom, archiveTo),
      env.DB.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('target_publication_rate','target_response_rate','target_booking_rate','target_completion_rate')`).bind(user.id),
    ]),
  ]);
  const [eventsResult, lessonsResult, chatResult, archiveReasonResult, targetResult] = batch;

  const eventRows = eventsResult.results as EventAggregate[];
  const completedRows = lessonsResult.results as Array<{ platform: string; count: number }>;
  const completedByPlatform = new Map(completedRows.map((row) => [row.platform, Number(row.count || 0)]));
  const totals = { joined: 0, publications: 0, responses: 0, bookings: 0, completed: 0 };
  const emptyCounts = (): FunnelCounts => ({ joined: 0, publications: 0, responses: 0, bookings: 0 });
  const byPlatform = new Map<string, FunnelCounts>();
  for (const row of eventRows) {
    const key = row.platform || 'unknown';
    const current = byPlatform.get(key) || emptyCounts();
    if (row.event_type === 'chat_joined') current.joined += Number(row.count || 0);
    if (row.event_type === 'publication') current.publications += Number(row.count || 0);
    if (row.event_type === 'lead_created') current.responses += Number(row.count || 0);
    if (row.event_type === 'lesson_booked' || row.event_type === 'curator_booking_pending') current.bookings += Number(row.count || 0);
    byPlatform.set(key, current);
  }
  const platformKeys = new Set([...byPlatform.keys(), ...completedByPlatform.keys()]);
  totals.joined = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.joined, 0);
  totals.publications = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.publications, 0);
  totals.responses = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.responses, 0);
  totals.bookings = Array.from(byPlatform.values()).reduce((sum, row) => sum + row.bookings, 0);
  totals.completed = Array.from(completedByPlatform.values()).reduce((sum, count) => sum + count, 0);
  const outcomes = {
    booked: eventRows.filter((row) => row.event_type === 'lesson_booked').reduce((sum,row)=>sum+Number(row.count||0),0),
    completed: eventRows.filter((row) => row.event_type === 'lesson_completed').reduce((sum,row)=>sum+Number(row.count||0),0),
    cancelled: eventRows.filter((row) => row.event_type === 'lesson_cancelled').reduce((sum,row)=>sum+Number(row.count||0),0),
    rescheduled: eventRows.filter((row) => row.event_type === 'lesson_rescheduled').reduce((sum,row)=>sum+Number(row.count||0),0),
    noShow: eventRows.filter((row) => row.event_type === 'lesson_no_show').reduce((sum,row)=>sum+Number(row.count||0),0),
  };
  const platforms: PlatformRow[] = Array.from(platformKeys)
    .filter((key) => key !== 'unknown')
    .map((key) => {
      const values = byPlatform.get(key) || emptyCounts();
      const completed = completedByPlatform.get(key) || 0;
      return {
        key,
        name: PLATFORM_META[key]?.name || key,
        color: PLATFORM_META[key]?.color || '#6b7280',
        ...values,
        completed,
        publicationRate: rate(values.publications, values.joined),
        responseRate: rate(values.responses, values.publications),
        bookingRate: rate(values.bookings, values.responses),
        completionRate: rate(completed, values.bookings),
      };
    })
    .sort((a, b) => b.publications - a.publications || a.name.localeCompare(b.name, 'uk'));

  const chats = (chatResult.results as Array<{
    chat_id: string; name: string | null; platform: string | null; workflow_status: string | null;
    language: string | null; directions_json: string | null;
    joined: number; publications: number; responses: number; bookings: number;
  }>).map((row) => ({
    id: row.chat_id,
    name: row.name || 'Без назви',
    platform: row.platform || 'unknown',
    platformName: PLATFORM_META[row.platform || '']?.name || row.platform || 'Інше',
    status: row.workflow_status || 'unknown',
    language: row.language === 'uk' || row.language === 'ru' ? row.language : null,
    directions: parseStringList(row.directions_json),
    joined: Number(row.joined || 0),
    publications: Number(row.publications || 0),
    responses: Number(row.responses || 0),
    bookings: Number(row.bookings || 0),
    publicationRate: rate(Number(row.publications || 0), Number(row.joined || 0)),
    responseRate: rate(Number(row.responses || 0), Number(row.publications || 0)),
    bookingRate: rate(Number(row.bookings || 0), Number(row.responses || 0)),
  }));
  const activityByChat = new Map(chats.map((row) => [row.id, row]));

  const data: AnalyticsExportData = {
    range,
    totals: {
      ...totals,
      publicationRate: rate(totals.publications, totals.joined),
      responseRate: rate(totals.responses, totals.publications),
      bookingRate: rate(totals.bookings, totals.responses),
      completionRate: rate(totals.completed, totals.bookings),
    },
    platforms,
    chats,
    cohort: {
      totals: {
        ...cohort.totals,
        bookingLeadRate: rate(cohort.totals.bookedLeads, cohort.totals.leads),
        completionRate: rate(cohort.totals.completed, cohort.totals.bookings),
        noShowRate: rate(cohort.totals.noShow, cohort.totals.bookings),
      },
      platforms: cohort.platforms.map((row) => ({
        key: row.platform,
        name: PLATFORM_META[row.platform]?.name || row.platform,
        ...row,
        bookingLeadRate: rate(row.bookedLeads, row.leads),
        completionRate: rate(row.completed, row.bookings),
        noShowRate: rate(row.noShow, row.bookings),
      })),
      chats: cohort.chats.map((row) => {
        const activity = activityByChat.get(row.id);
        const publications = activity?.publications || 0;
        return {
          ...row,
          platformName: PLATFORM_META[row.platform]?.name || row.platform,
          publications,
          leadRate: rate(row.leads, publications),
          bookingLeadRate: rate(row.bookedLeads, row.leads),
          completionRate: rate(row.completed, row.bookings),
          noShowRate: rate(row.noShow, row.bookings),
        };
      }),
    },
  };

  if (url.searchParams.get('format') === 'csv') {
    return new Response(analyticsCsv(data), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="work-os-analytics-${from}-${to}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const archiveReasons = (archiveReasonResult.results as ArchiveReasonRow[]).map((row) => ({
    reason: row.reason,
    count: Number(row.count || 0),
  }));
  const targetMap=new Map((targetResult.results as Array<{setting_key:string;value_json:string}>).map(row=>[row.setting_key,settingPercent(row.value_json)]));
  const targets={publicationRate:targetMap.get('target_publication_rate')||0,responseRate:targetMap.get('target_response_rate')||0,bookingRate:targetMap.get('target_booking_rate')||0,completionRate:targetMap.get('target_completion_rate')||0};
  const insights = {
    recommendation: buildAnalyticsRecommendation(chats, range.days),
    archiveReasons,
    archivedChats: archiveReasons.reduce((sum, row) => sum + row.count, 0),
  };
  return Response.json({ ...data, targets, outcomes, insights, trends, subjects }, { headers: { 'Cache-Control': 'no-store' } });
}

function settingPercent(value:string):number { try { const parsed=JSON.parse(value); return Number.isInteger(parsed)&&parsed>=0&&parsed<=100?parsed:0; } catch { return 0; } }

function parseStringList(value:string|null):string[] {
  if (!value) return [];
  try {
    const parsed:unknown=JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function rate(value: number, base: number): number {
  return base > 0 ? Math.round((value / base) * 1000) / 10 : 0;
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
