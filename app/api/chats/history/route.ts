import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readChatHistory } from '@/lib/chats/history';
import { CHAT_ANALYTICS_PERIODS, readChatAnalytics, type ChatAnalyticsPeriod } from '@/lib/chats/analytics';
import { businessDate } from '@/lib/business-time';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error:'Потрібно увійти.' }, { status:401 });
  const url = new URL(request.url); const id = url.searchParams.get('id') || '';
  const periodValue=url.searchParams.get('period')||'30';
  if(!CHAT_ANALYTICS_PERIODS.includes(periodValue as ChatAnalyticsPeriod)) return Response.json({error:'Некоректний період.'},{status:400});
  if (!id || id.length > 100) return Response.json({ error:'Чат не знайдено.' }, { status:400 });
  const exists = await env.DB.prepare('SELECT 1 FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1').bind(id,user.id).first();
  if (!exists) return Response.json({ error:'Чат не знайдено.' }, { status:404 });
  const [events,analytics]=await Promise.all([
    readChatHistory(env.DB,user.id,id),
    readChatAnalytics(env.DB,{userId:user.id,chatId:id,period:periodValue as ChatAnalyticsPeriod,to:businessDate(Math.floor(Date.now()/1000))}),
  ]);
  return Response.json({ events,analytics }, { headers:{'Cache-Control':'no-store'} });
}
