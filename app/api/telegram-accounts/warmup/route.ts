import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { changeTelegramWarmupReady, readTelegramWarmup } from '@/lib/chats/telegram-warmup';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const REQUEST_MAX_BYTES=8*1024;

export async function GET(request:Request):Promise<Response> {
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const accountId=(new URL(request.url).searchParams.get('account')||'').trim();
  if(!accountId)return Response.json({error:'Оберіть Telegram-акаунт.'},{status:400});
  try {
    return Response.json({warmup:await readTelegramWarmup(env.DB,user.id,accountId)},{headers:{'Cache-Control':'no-store'}});
  } catch(reason) {
    return Response.json({error:reason instanceof Error?reason.message:'Не вдалося завантажити план прогріву.'},{status:404});
  }
}

export async function POST(request:Request):Promise<Response> {
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const parsed=await readJsonObject(request,REQUEST_MAX_BYTES);
  if(parsed instanceof Response)return parsed;
  const accountId=typeof parsed.accountId==='string'?parsed.accountId.trim():'';
  const action=typeof parsed.action==='string'?parsed.action:'';
  if(!accountId||!['complete','reopen'].includes(action))return Response.json({error:'Некоректна дія.'},{status:400});
  try {
    const warmup=await changeTelegramWarmupReady(env.DB,{userId:user.id,accountId,ready:action==='complete',now:Math.floor(Date.now()/1000)});
    return Response.json({ok:true,warmup});
  } catch(reason) {
    return Response.json({error:reason instanceof Error?reason.message:'Не вдалося оновити план прогріву.'},{status:409});
  }
}
