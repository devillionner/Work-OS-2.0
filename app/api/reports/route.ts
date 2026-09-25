import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement, type ActivitySummaryRow } from '@/lib/activity-summary';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readReportEventDetails } from '@/lib/reports/details';
import { readReportCalendar } from '@/lib/reports/calendar';
import { readCalendarContext } from '@/lib/reports/calendar-context';
import { readPreviousReportReminder } from '@/lib/reports/reminders';
import { readFinalReportState } from '@/lib/reports/final';
import { readGoalPlanFact } from '@/lib/goals';
import { saveReportText } from '@/lib/reports/write';
import { composeDailyReportText } from '@/lib/reports/compose';
import { revisionCacheRequest, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';

const REQUEST_MAX_BYTES = 32 * 1024;
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
  const now=Math.floor(Date.now()/1000);
  const cacheRequest=await revisionCacheRequest(env.DB,user.id,'reports',`${month}:${date || ''}:${Math.floor(now/30)}`);
  const cached=await matchRevisionJson(cacheRequest);
  if(cached)return cached;
  const [calendar, calendarContext, selectedResult] = await Promise.all([
    readReportCalendar(env.DB, user.id, start, end),
    readCalendarContext(env.DB, user.id, start, end),
    env.DB.prepare(`SELECT id,report_date,report_text,submitted_at,updated_at,revision_count FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`).bind(user.id, validDate(date) ? date : start).first<ReportRow>(),
  ]);
  const selected = selectedResult ?? undefined;
  const selectedDate = selected?.report_date || (validDate(date) && date!.startsWith(month) ? date : null);
  const [summary, details, previousReportReminder, finalReportState, goalPlanFact] = await Promise.all([
    selectedDate ? eventSummary(user.id, selectedDate) : Promise.resolve([]),
    selectedDate ? readReportEventDetails(env.DB, user.id, selectedDate) : Promise.resolve([]),
    readPreviousReportReminder(env.DB, user.id, kyivDate()),
    selectedDate ? readFinalReportState(env.DB,user.id,selectedDate,now,kyivDate()) : Promise.resolve(null),
    selectedDate ? readGoalPlanFact(env.DB,user.id,selectedDate) : Promise.resolve(null),
  ]);
  const selectedPublic = selected
    ? { ...publicReport(selected), stale: calendar.find((item) => item.id === selected.id)?.stale ?? false }
    : null;
  const suggestedText = selectedDate && !selected ? composeDailyReportText(selectedDate, summary, details) : '';
  const payload={ month, reports: calendar, calendarContext, selected: selectedPublic, suggestedText, summary, details, previousReportReminder, finalReportState, goalPlanFact, leadCommandScope: `reports:${user.id}` };
  await putRevisionJson(cacheRequest,payload,45);
  return Response.json(payload,{headers:{'Cache-Control':'no-store','X-Work-OS-Cache':'MISS'}});
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { date?: unknown; text?: unknown; submitted?: unknown; expectedRevision?: unknown };
  const date = typeof body.date === 'string' && validDate(body.date) ? body.date : '';
  const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : '';
  const expectedRevision = typeof body.expectedRevision === 'number' && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0
    ? body.expectedRevision
    : null;
  if (!date || !text.trim()) return Response.json({ error: 'Вкажіть дату та текст звіту.' }, { status: 400 });
  if (expectedRevision === null) return Response.json({ error: 'Оновіть звіт перед збереженням.' }, { status: 400 });
  if (date > kyivDate()) return Response.json({ error: 'Майбутні звіти недоступні.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const wantsSubmit = body.submitted === true;
  if (wantsSubmit) { const state=await readFinalReportState(env.DB,user.id,date,now,kyivDate()); if(!state.canSubmit) return Response.json({error:state.reason},{status:409}); }
  const result = await saveReportText(env.DB, { userId:user.id, date, text, submitted:wantsSubmit, expectedRevision, now });
  if (!result.ok) return Response.json({ error:'Звіт уже змінено на іншому пристрої. Оновіть дані.', currentRevision:result.currentRevision }, { status:409 });
  return Response.json({ ok:true, report:{ id:result.id, date, text, submittedAt:result.submittedAt, updatedAt:result.updatedAt, revisionCount:result.revision } });
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
