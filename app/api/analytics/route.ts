import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement } from '@/lib/activity-summary';
import { completedOperatorLessonsStatement } from '@/lib/analytics-attribution';
import { readAnalyticsCohort } from '@/lib/analytics-cohort';
import { analyticsCsv, type AnalyticsExportData } from '@/lib/analytics-export';
import { buildAnalyticsRecommendation } from '@/lib/analytics-insights';
import { resolveAnalyticsRange } from '@/lib/analytics-range';
import { readAnalyticsTrends } from '@/lib/analytics-trends';
import { chatActivityStatement } from '@/lib/analytics-chats';
import { businessDayStart, shiftBusinessDate } from '@/lib/business-time';
import { readSubjectAnalyticsRange } from '@/lib/reports/subjects';
import { revisionCacheRequest, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';

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
  const wantsCsv = url.searchParams.get('format') === 'csv';
  // compare=1: порівняльний період для дельт KPI й пунктиру графіка — лише підсумки й тренд, без когорт, рейтингу чатів і предметів.
  // cohort=0: основний запит без когорт — вони вантажаться окремо (/api/analytics/cohort), коли картка потрапляє в в'юпорт.
  const compare = !wantsCsv && url.searchParams.get('compare') === '1';
  const skipCohort = !wantsCsv && url.searchParams.get('cohort') === '0';
  const cacheKey = `${from}:${to}${compare ? ':compare' : skipCohort ? ':nocohort' : ''}`;
  const cacheRequest = wantsCsv ? null : await revisionCacheRequest(env.DB, user.id, 'analytics', cacheKey);
  if (cacheRequest) {
    const cached = await matchRevisionJson(cacheRequest);
    if (cached) return cached;
  }
  if (compare) {
    const [trends, [summary, completed]] = await Promise.all([
      readAnalyticsTrends(env.DB, user.id, from, to),
      env.DB.batch([activitySummaryStatement(env.DB, user.id, from, to), completedOperatorLessonsStatement(env.DB, user.id, from, to)]),
    ]);
    const totals = funnelTotals(summary.results as EventAggregate[], completed.results as Array<{ platform: string; count: number }>);
    const light = { range, totals: { ...totals, ...totalRates(totals) }, trends };
    if (cacheRequest) await putRevisionJson(cacheRequest, light, 600);
    return Response.json(light, { headers: { 'Cache-Control': 'no-store', 'X-Work-OS-Cache': 'MISS' } });
  }
  const archiveFrom = businessDayStart(from);
  const archiveTo = businessDayStart(shiftBusinessDate(to, 1));

  const [cohort, trends, subjects, batch] = await Promise.all([
    skipCohort ? Promise.resolve(null) : readAnalyticsCohort(env.DB, user.id, from, to),
    readAnalyticsTrends(env.DB, user.id, from, to),
    readSubjectAnalyticsRange(env.DB, user.id, from, to),
    env.DB.batch([
      activitySummaryStatement(env.DB, user.id, from, to),
      completedOperatorLessonsStatement(env.DB, user.id, from, to),
      chatActivityStatement(env.DB, user.id, from, to),
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
  const totals = funnelTotals(eventRows, completedRows);
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

  const cohortPart = cohort ? {
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
  } : null;
  const base = {
    range,
    totals: { ...totals, ...totalRates(totals) },
    platforms,
    chats,
  };
  // Когорти є завжди в експорті; у JSON для екрана їх немає (cohort=0) і вони приходять із /api/analytics/cohort.
  const data = (cohortPart ? { ...base, cohort: cohortPart } : base) as AnalyticsExportData;

  if (wantsCsv) {
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
  const payload = { ...data, targets, outcomes, insights, trends, subjects };
  // Revision + date range are in the key (any write or a new day yields a new key), so the longest
  // lifetime putRevisionJson allows cannot serve stale numbers.
  if (cacheRequest) await putRevisionJson(cacheRequest, payload, 600);
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store', 'X-Work-OS-Cache':'MISS' } });
}

type FunnelTotals = { joined: number; publications: number; responses: number; bookings: number; completed: number };
function funnelTotals(eventRows: EventAggregate[], completedRows: Array<{ platform: string; count: number }>): FunnelTotals {
  const totals: FunnelTotals = { joined: 0, publications: 0, responses: 0, bookings: 0, completed: 0 };
  for (const row of eventRows) {
    const count = Number(row.count || 0);
    if (row.event_type === 'chat_joined') totals.joined += count;
    if (row.event_type === 'publication') totals.publications += count;
    if (row.event_type === 'lead_created') totals.responses += count;
    if (row.event_type === 'lesson_booked' || row.event_type === 'curator_booking_pending') totals.bookings += count;
  }
  totals.completed = completedRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return totals;
}
function totalRates(totals: FunnelTotals) {
  return {
    publicationRate: rate(totals.publications, totals.joined),
    responseRate: rate(totals.responses, totals.publications),
    bookingRate: rate(totals.bookings, totals.responses),
    completionRate: rate(totals.completed, totals.bookings),
  };
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
