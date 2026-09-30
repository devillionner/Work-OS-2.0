import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readWaitingWhatsAppCheckStatus, startWaitingWhatsAppCheck, stopWaitingWhatsAppCheck } from '@/lib/chat-discovery/executor';

export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  return Response.json(await readWaitingWhatsAppCheckStatus(env.DB,user.id),{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  if(!sameOrigin(request))return Response.json({error:'Недійсний запит.'},{status:403});
  const body=await readJsonObject(request,8*1024);
  if(body instanceof Response)return body;
  const now=Math.floor(Date.now()/1000);
  if(body.action==='start')return Response.json(await startWaitingWhatsAppCheck(env.DB,user.id,now));
  if(body.action==='stop'){
    if(!Number.isSafeInteger(body.batchId)||Number(body.batchId)<=0)return Response.json({error:'Некоректний пакет перевірки.'},{status:400});
    return Response.json(await stopWaitingWhatsAppCheck(env.DB,user.id,Number(body.batchId),now));
  }
  return Response.json({error:'Невідома дія.'},{status:400});
}
