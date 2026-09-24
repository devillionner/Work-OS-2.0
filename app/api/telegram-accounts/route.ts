import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const REQUEST_MAX_BYTES = 16 * 1024;

type AccountRow = {
  id:string; account_number:number; name:string; is_enabled:number; is_selected:number;
  join_streak:number; join_batch_size:number; break_minutes:number; break_until:number|null;
};

export async function GET():Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  const now=unixNow();
  await ensureDefaultAccount(user.id,now);
  await env.DB.prepare(`UPDATE telegram_accounts SET join_streak=0,break_until=NULL,updated_at=?1 WHERE user_id=?2 AND break_until IS NOT NULL AND break_until<=?1`).bind(now,user.id).run();
  const result=await env.DB.prepare(`SELECT id,account_number,name,is_enabled,is_selected,join_streak,join_batch_size,break_minutes,break_until FROM telegram_accounts WHERE user_id=?1 ORDER BY account_number`).bind(user.id).all<AccountRow>();
  return Response.json({accounts:result.results.map(publicAccount)});
}

export async function POST(request:Request):Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request)) return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response) return parsed;
  const body=parsed;
  const action=typeof body.action==='string'?body.action:'';
  const id=typeof body.id==='string'?body.id:'';
  const now=unixNow();

  if(action==='create') {
    const row=await env.DB.prepare(`SELECT COALESCE(MAX(account_number),0)+1 AS next_number FROM telegram_accounts WHERE user_id=?1`).bind(user.id).first<{next_number:number}>();
    const number=Math.max(1,Number(row?.next_number||1));
    const accountId=crypto.randomUUID();
    const name=cleanName(body.name)||`TG ${number}`;
    await env.DB.prepare(`INSERT INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES (?1,?2,?3,?4,1,0,?5,?5)`).bind(accountId,user.id,number,name,now).run();
    return Response.json({ok:true,id:accountId});
  }

  const account=await env.DB.prepare(`SELECT id,is_enabled,is_selected,break_minutes FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(id,user.id).first<{id:string;is_enabled:number;is_selected:number;break_minutes:number}>();
  if(!account) return Response.json({error:'Telegram-акаунт не знайдено.'},{status:404});

  if(action==='select') {
    if(!account.is_enabled) return Response.json({error:'Спочатку увімкніть цей акаунт.'},{status:409});
    await env.DB.batch([
      env.DB.prepare(`UPDATE telegram_accounts SET is_selected=0,updated_at=?1 WHERE user_id=?2 AND is_selected=1`).bind(now,user.id),
      env.DB.prepare(`UPDATE telegram_accounts SET is_selected=1,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,id,user.id),
    ]);
  } else if(action==='rename') {
    const name=cleanName(body.name);
    if(!name) return Response.json({error:'Вкажіть назву акаунта.'},{status:400});
    await env.DB.prepare(`UPDATE telegram_accounts SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(name,now,id,user.id).run();
  } else if(action==='toggle') {
    if(account.is_enabled) {
      const enabled=await env.DB.prepare(`SELECT COUNT(*) AS count FROM telegram_accounts WHERE user_id=?1 AND is_enabled=1`).bind(user.id).first<{count:number}>();
      if(Number(enabled?.count||0)<=1) return Response.json({error:'Має залишитися хоча б один активний акаунт.'},{status:409});
      const replacement=account.is_selected?await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE user_id=?1 AND is_enabled=1 AND id!=?2 ORDER BY account_number LIMIT 1`).bind(user.id,id).first<{id:string}>():null;
      await env.DB.batch([
        env.DB.prepare(`UPDATE telegram_accounts SET is_enabled=0,is_selected=0,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,id,user.id),
        ...(replacement?[env.DB.prepare(`UPDATE telegram_accounts SET is_selected=1,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,replacement.id,user.id)]:[]),
      ]);
    } else {
      await env.DB.prepare(`UPDATE telegram_accounts SET is_enabled=1,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,id,user.id).run();
    }
  } else if(action==='start_break') {
    const minutes=Math.min(60,Math.max(5,Number(body.minutes)||account.break_minutes||15));
    await env.DB.prepare(`UPDATE telegram_accounts SET break_minutes=?1,break_until=?2,updated_at=?3 WHERE id=?4 AND user_id=?5`).bind(minutes,now+minutes*60,now,id,user.id).run();
  } else if(action==='settings') {
    const batch=Math.min(20,Math.max(1,Number(body.joinBatchSize)||5));
    const minutes=Math.min(60,Math.max(5,Number(body.breakMinutes)||15));
    await env.DB.prepare(`UPDATE telegram_accounts SET join_batch_size=?1,break_minutes=?2,updated_at=?3 WHERE id=?4 AND user_id=?5`).bind(batch,minutes,now,id,user.id).run();
  } else {
    return Response.json({error:'Невідома дія.'},{status:400});
  }
  return Response.json({ok:true});
}

function publicAccount(row:AccountRow) { return {id:row.id,number:Number(row.account_number),name:row.name,enabled:Boolean(row.is_enabled),selected:Boolean(row.is_selected),joinStreak:Number(row.join_streak),joinBatchSize:Number(row.join_batch_size),breakMinutes:Number(row.break_minutes),breakUntil:row.break_until}; }
function cleanName(value:unknown) { return typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,50):''; }
function unixNow() { return Math.floor(Date.now()/1000); }
async function ensureDefaultAccount(userId:string,now:number) {
  await env.DB.prepare(`INSERT OR IGNORE INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES (?1,?2,1,'TG 1',1,1,?3,?3)`).bind(`${userId}:tg1`,userId,now).run();
}
