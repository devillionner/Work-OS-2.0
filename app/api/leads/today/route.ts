import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readTodayLeadsActivity } from '@/lib/leads/today';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });

  const date = businessDate(Math.floor(Date.now() / 1000));
  const activity = await readTodayLeadsActivity(env.DB, user.id, date);
  return Response.json(activity, { headers: { 'Cache-Control': 'no-store' } });
}
