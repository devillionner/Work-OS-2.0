import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readLeadHistory } from '@/lib/leads/history';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id || id.length > 100) return Response.json({ error: 'Ліда не знайдено.' }, { status: 400 });
  const exists = await env.DB.prepare('SELECT 1 FROM leads WHERE id=?1 AND user_id=?2 LIMIT 1').bind(id, user.id).first();
  if (!exists) return Response.json({ error: 'Ліда не знайдено.' }, { status: 404 });
  return Response.json({ events: await readLeadHistory(env.DB, user.id, id) }, { headers: { 'Cache-Control': 'no-store' } });
}
