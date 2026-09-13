import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { cleanChatName, type ChatPlatform } from '@/lib/chats/bulk-input';
import { readChatDuplicateGroups } from '@/lib/chats/duplicates';
import { chatStateEvent, chatStateTokenSql } from '@/lib/chats/state';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const PLATFORMS=new Set<ChatPlatform>(['telegram','whatsapp','viber','facebook']);
const REQUEST_MAX_BYTES=16*1024;

export async function GET(request:Request):Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  const url=new URL(request.url);
  const platform=url.searchParams.get('platform') as ChatPlatform|null;
  if(!platform||!PLATFORMS.has(platform)) return Response.json({error:'Невідома платформа.'},{status:400});
  const accountId=platform==='telegram'?(url.searchParams.get('account')||'').trim():null;
  if(platform==='telegram'&&!accountId) return Response.json({error:'Оберіть Telegram-акаунт.'},{status:400});
  try {
    const groups=await readChatDuplicateGroups(env.DB,{userId:user.id,platform,accountId});
    return Response.json({groups},{headers:{'Cache-Control':'no-store'}});
  } catch(reason) {
    return Response.json({error:reason instanceof Error?reason.message:'Не вдалося перевірити дублікати.'},{status:409});
  }
}

export async function POST(request:Request):Promise<Response> {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request)) return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response) return parsed;
  const action=typeof parsed.action==='string'?parsed.action:'';
  const id=typeof parsed.id==='string'?parsed.id.trim().slice(0,200):'';
  const expected=typeof parsed.stateToken==='string'?parsed.stateToken:'';
  if(action!=='rename'||!id||!expected) return Response.json({error:'Некоректна дія.'},{status:400});
  const name=cleanChatName(typeof parsed.name==='string'?parsed.name:'');
  if(!name) return Response.json({error:'Назва чату не може бути порожньою.'},{status:400});

  const row=await env.DB.prepare(`SELECT c.name,${chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1 AND c.user_id=?2 LIMIT 1`)
    .bind(id,user.id).first<{name:string;state_token:string}>();
  if(!row) return Response.json({error:'Чат не знайдено.'},{status:404});
  if(row.state_token!==expected) return Response.json({error:'Чат уже змінився. Оновіть список.'},{status:409});
  if(row.name===name) return Response.json({ok:true,stateToken:row.state_token});

  const now=Math.floor(Date.now()/1000);
  const eventId=crypto.randomUUID();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE chats SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 AND ${chatStateTokenSql('chats')}=?5`)
      .bind(name,now,id,user.id,expected),
    chatStateEvent(env.DB,{id:eventId,userId:user.id,chatId:id,action:'rename',now,previous:expected}),
  ]);
  if(!results[0].meta.changes) return Response.json({error:'Чат уже змінився. Оновіть список.'},{status:409});
  const next=await env.DB.prepare(`SELECT ${chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1 AND c.user_id=?2 LIMIT 1`)
    .bind(id,user.id).first<{state_token:string}>();
  return Response.json({ok:true,stateToken:next?.state_token||''});
}
