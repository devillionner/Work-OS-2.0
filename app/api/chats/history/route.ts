import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readChatHistory } from '@/lib/chats/history';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error:'Потрібно увійти.' }, { status:401 });
  const url = new URL(request.url); const id = url.searchParams.get('id') || '';
  if (!id || id.length > 100) return Response.json({ error:'Чат не знайдено.' }, { status:400 });
  const exists = await env.DB.prepare('SELECT 1 FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1').bind(id,user.id).first();
  if (!exists) return Response.json({ error:'Чат не знайдено.' }, { status:404 });
  return Response.json({ events:await readChatHistory(env.DB,user.id,id) }, { headers:{'Cache-Control':'no-store'} });
}
