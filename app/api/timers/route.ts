import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readTimers } from '@/lib/timers';

const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook', 'general']);

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const now = unixNow();
  const timers = await readTimers(env.DB, user.id, now);
  return Response.json({timers,serverNow:now}, {headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body=await request.json() as {action?:unknown;id?:unknown;durationMinutes?:unknown;platform?:unknown;label?:unknown;telegramAccountId?:unknown};
  const action=typeof body.action==='string'?body.action:'';
  const now=unixNow();
  if(action==='start') {
    const durationMinutes=Number(body.durationMinutes);
    const platform=typeof body.platform==='string'&&PLATFORMS.has(body.platform)?body.platform:'general';
    if(![5,10,15].includes(durationMinutes)||platform==='telegram'&&durationMinutes!==15) return Response.json({error:platform==='telegram'?'Для Telegram таймер триває 15 хвилин.':'Оберіть 5, 10 або 15 хвилин.'},{status:400});
    const label=(typeof body.label==='string'?body.label.trim():'').slice(0,60)||platformLabel(platform);
    const accountId=platform==='telegram'&&typeof body.telegramAccountId==='string'?body.telegramAccountId:null;
    if(accountId) {
      const exists=await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1`).bind(accountId,user.id).first();
      if(!exists) return Response.json({error:'Telegram-акаунт не знайдено.'},{status:400});
    }
    const id=crypto.randomUUID();
    const endsAt=now+durationMinutes*60;
    await env.DB.prepare(`INSERT INTO work_timers (id,user_id,label,platform,telegram_account_id,duration_seconds,started_at,ends_at,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'running',?7,?7)`).bind(id,user.id,label,platform,accountId,durationMinutes*60,now,endsAt).run();
    return Response.json({ok:true,timer:{id,label,platform,telegramAccountId:accountId,durationSeconds:durationMinutes*60,startedAt:now,endsAt,status:'running',completedAt:null}});
  }
  if(action==='dismiss') {
    const id=typeof body.id==='string'?body.id:'';
    if(!id) return Response.json({error:'Таймер не знайдено.'},{status:400});
    const result=await env.DB.prepare(`UPDATE work_timers SET status='dismissed',dismissed_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3 AND status IN ('running','completed')`).bind(now,id,user.id).run();
    if(!result.meta.changes) return Response.json({error:'Таймер уже закрито.'},{status:409});
    return Response.json({ok:true});
  }
  return Response.json({error:'Невідома дія.'},{status:400});
}

function platformLabel(platform:string) { return ({telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook',general:'Загальний'} as Record<string,string>)[platform]||'Загальний'; }
function sameOrigin(request:Request) { const origin=request.headers.get('origin'); return Boolean(origin&&origin===new URL(request.url).origin); }
function unixNow() { return Math.floor(Date.now()/1000); }
