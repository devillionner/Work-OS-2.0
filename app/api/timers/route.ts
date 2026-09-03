import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook', 'general']);
type TimerRow = {
  id:string; label:string; platform:string|null; telegram_account_id:string|null;
  duration_seconds:number; started_at:number; ends_at:number; status:string;
  completed_at:number|null; created_at:number;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const now = unixNow();
  await env.DB.prepare(`UPDATE work_timers SET status='completed',completed_at=COALESCE(completed_at,?1),updated_at=?1 WHERE user_id=?2 AND status='running' AND ends_at<=?1`).bind(now,user.id).run();
  const result = await env.DB.prepare(`SELECT id,label,platform,telegram_account_id,duration_seconds,started_at,ends_at,status,completed_at,created_at FROM work_timers WHERE user_id=?1 AND status IN ('running','completed') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,ends_at`).bind(user.id).all<TimerRow>();
  return Response.json({timers:result.results.map(publicTimer),serverNow:now});
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

function publicTimer(row:TimerRow) { return {id:row.id,label:row.label,platform:row.platform,telegramAccountId:row.telegram_account_id,durationSeconds:Number(row.duration_seconds),startedAt:Number(row.started_at),endsAt:Number(row.ends_at),status:row.status,completedAt:row.completed_at,createdAt:Number(row.created_at)}; }
function platformLabel(platform:string) { return ({telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook',general:'Загальний'} as Record<string,string>)[platform]||'Загальний'; }
function sameOrigin(request:Request) { const origin=request.headers.get('origin'); return Boolean(origin&&origin===new URL(request.url).origin); }
function unixNow() { return Math.floor(Date.now()/1000); }
