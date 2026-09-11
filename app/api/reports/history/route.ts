import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readReportHistory } from '@/lib/reports/history';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!validDate(date)) return Response.json({ error: 'Некоректна дата звіту.' }, { status: 400 });
  return Response.json({ events: await readReportHistory(env.DB, user.id, date) }, { headers: { 'Cache-Control': 'no-store' } });
}

function validDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
