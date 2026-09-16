import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readSubjectAnalytics, SUBJECT_PERIODS, type SubjectPeriod } from '@/lib/reports/subjects';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const date = params.get('date') || '';
  const period = params.get('period') || 'day';
  if (!validDate(date))
    return Response.json({ error: 'Некоректна дата.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (date > businessDate(Math.floor(Date.now() / 1000)))
    return Response.json({ error: 'Майбутня дата недоступна.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (!SUBJECT_PERIODS.includes(period as SubjectPeriod))
    return Response.json({ error: 'Некоректний період предметів.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

  const subjects = await readSubjectAnalytics(env.DB, user.id, date, period as SubjectPeriod);
  return Response.json(subjects, { headers: { 'Cache-Control': 'no-store' } });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
