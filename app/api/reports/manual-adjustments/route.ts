import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement, type ActivitySummaryRow } from '@/lib/activity-summary';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readReportEventDetails } from '@/lib/reports/details';
import {
  applyReportManualAdjustments,
  reportFactTotals,
  reportManualAdjustmentsAreValidForFacts,
  reportManualAdjustmentsFromPayload,
  validateReportManualAdjustments,
  writeReportManualAdjustmentsPayload,
  type ReportManualAdjustments,
} from '@/lib/reports/manual-adjustments';

const REQUEST_MAX_BYTES = 8 * 1024;
type ReportRow = { payload_json: string | null; revision_count: number };

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!validDate(date) || date > kyivDate())
    return Response.json({ error: 'Некоректна дата звіту.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(await snapshot(user.id, date), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { date?: unknown; adjustments?: unknown; expectedRevision?: unknown };
  const date = typeof body.date === 'string' && validDate(body.date) ? body.date : '';
  const adjustments = validateReportManualAdjustments(body.adjustments);
  const expectedRevision = typeof body.expectedRevision === 'number' && Number.isSafeInteger(body.expectedRevision)
    ? body.expectedRevision
    : null;
  if (!date || date > kyivDate()) return Response.json({ error: 'Некоректна дата звіту.' }, { status: 400 });
  if (!adjustments) return Response.json({ error: 'Некоректна ручна корекція.' }, { status: 400 });
  if (expectedRevision === null) return Response.json({ error: 'Оновіть звіт перед збереженням корекції.' }, { status: 400 });

  const before = await snapshot(user.id, date);
  if (!before.reportExists || before.revision === null)
    return Response.json({ error: 'Спочатку збережіть чернетку звіту.' }, { status: 409 });
  if (before.revision !== expectedRevision)
    return Response.json({ error: 'Звіт уже змінено на іншому пристрої. Оновіть дані.' }, { status: 409 });
  if (!reportManualAdjustmentsAreValidForFacts(before.facts, adjustments))
    return Response.json({ error: 'Підсумкове число не може бути від’ємним.' }, { status: 400 });

  const row = await env.DB.prepare(`SELECT payload_json,revision_count FROM daily_reports
    WHERE user_id=?1 AND report_date=?2 LIMIT 1`).bind(user.id, date).first<ReportRow>();
  if (!row || Number(row.revision_count || 1) !== expectedRevision)
    return Response.json({ error: 'Звіт уже змінено на іншому пристрої. Оновіть дані.' }, { status: 409 });

  const now = Math.floor(Date.now() / 1000);
  const payloadJson = writeReportManualAdjustmentsPayload(row.payload_json, adjustments, now);
  const result = await env.DB.prepare(`UPDATE daily_reports
    SET payload_json=?1,updated_at=?2,revision_count=COALESCE(revision_count,1)+1,source_import_id=NULL
    WHERE user_id=?3 AND report_date=?4 AND COALESCE(revision_count,1)=?5`)
    .bind(payloadJson, now, user.id, date, expectedRevision).run();
  if (!result.meta.changes)
    return Response.json({ error: 'Звіт уже змінено на іншому пристрої. Оновіть дані.' }, { status: 409 });

  return Response.json(await snapshot(user.id, date), { headers: { 'Cache-Control': 'no-store' } });
}

async function snapshot(userId: string, date: string): Promise<{
  date: string;
  reportExists: boolean;
  revision: number | null;
  facts: ReportManualAdjustments;
  adjustments: ReportManualAdjustments;
  totals: ReportManualAdjustments;
  details: Awaited<ReturnType<typeof readReportEventDetails>>;
}> {
  const [report, summaryResult, details] = await Promise.all([
    env.DB.prepare(`SELECT payload_json,revision_count FROM daily_reports
      WHERE user_id=?1 AND report_date=?2 LIMIT 1`).bind(userId, date).first<ReportRow>(),
    activitySummaryStatement(env.DB, userId, date, date).all<ActivitySummaryRow>(),
    readReportEventDetails(env.DB, userId, date),
  ]);
  const facts = reportFactTotals(summaryResult.results.map((row) => ({
    eventType: row.event_type,
    count: Number(row.count || 0),
  })));
  const adjustments = reportManualAdjustmentsFromPayload(report?.payload_json);
  return {
    date,
    reportExists: Boolean(report),
    revision: report ? Number(report.revision_count || 1) : null,
    facts,
    adjustments,
    totals: applyReportManualAdjustments(facts, adjustments),
    details,
  };
}

function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
