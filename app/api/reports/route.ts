import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement, type ActivitySummaryRow } from '@/lib/activity-summary';
import { readReportEventDetails } from '@/lib/reports/details';
import { readReportCalendar } from '@/lib/reports/calendar';

type ReportRow = { id: string; report_date: string; report_text: string; submitted_at: number | null; updated_at: number; revision_count: number; stale?: number };

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const month = validMonth(url.searchParams.get('month')) ? url.searchParams.get('month')! : kyivDate().slice(0, 7);
  const date = url.searchParams.get('date');
  if (validDate(date) && date > kyivDate()) return Response.json({ error: 'Майбутні звіти недоступні.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const start = `${month}-01`;
  const end = shiftMonth(start, 1);
  const [calendar, selectedResult] = await Promise.all([
    readReportCalendar(env.DB, user.id, start, end),
    env.DB.prepare(`SELECT id,report_date,report_text,submitted_at,updated_at,revision_count FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`).bind(user.id, validDate(date) ? date : start).first<ReportRow>(),
  ]);
  const selected = selectedResult ?? undefined;
  const selectedDate = selected?.report_date || (validDate(date) && date!.startsWith(month) ? date : null);
  const [summary, details] = selectedDate
    ? await Promise.all([eventSummary(user.id, selectedDate), readReportEventDetails(env.DB, user.id, selectedDate)])
    : [[], []];
  const selectedPublic = selected
    ? { ...publicReport(selected), stale: calendar.find((item) => item.id === selected.id)?.stale ?? false }
    : null;
  return Response.json({ month, reports: calendar, selected: selectedPublic, summary, details }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { date?: unknown; text?: unknown; submitted?: unknown };
  const date = typeof body.date === 'string' && validDate(body.date) ? body.date : '';
  const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : '';
  if (!date || !text.trim()) return Response.json({ error: 'Вкажіть дату та текст звіту.' }, { status: 400 });
  if (date > kyivDate()) return Response.json({ error: 'Майбутні звіти недоступні.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const id = `report_${user.id}_${date}`;
  const submittedAt = body.submitted === false ? null : now;
  await env.DB.prepare(`INSERT INTO daily_reports (id,user_id,report_date,report_text,payload_json,submitted_at,updated_at,source_import_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,NULL)
    ON CONFLICT(user_id,report_date) DO UPDATE SET report_text=excluded.report_text,payload_json=excluded.payload_json,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,revision_count=COALESCE(daily_reports.revision_count,1)+1,source_import_id=NULL
    WHERE daily_reports.user_id=excluded.user_id`).bind(id, user.id, date, text, JSON.stringify({ source: 'manual', updatedAt: now }), submittedAt, now).run();
  return Response.json({ ok: true, report: { id, date, text, submittedAt, updatedAt: now } });
}

function publicReport(row: ReportRow) { return { id: row.id, date: row.report_date, text: row.report_text, submittedAt: row.submitted_at, updatedAt: row.updated_at, revisionCount: Number(row.revision_count || 1), stale: Boolean(row.stale) }; }

async function eventSummary(userId: string, date: string) {
  const result = await activitySummaryStatement(env.DB, userId, date, date).all<ActivitySummaryRow>();
  return result.results.map((row) => ({ platform: row.platform || 'unknown', eventType: row.event_type, count: Number(row.count || 0) }));
}

function validMonth(value: string | null): boolean { return Boolean(value && /^\d{4}-\d{2}$/.test(value) && Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12); }
function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function shiftMonth(value: string, offset: number): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 10); }
function kyivDate(): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
