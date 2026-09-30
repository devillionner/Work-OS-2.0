import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readWaitingWhatsAppCheckStatus, startWaitingWhatsAppCheck, stopWaitingWhatsAppCheck } from '@/lib/chat-discovery/executor';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

export async function GET():Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    return json(await readWaitingWhatsAppCheckStatus(env.DB,user.id));
  }catch(error){
    console.error('WhatsApp waiting-check status failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося отримати стан перевірки WhatsApp.'},500);
  }
}

export async function POST(request:Request):Promise<Response>{
  try{
    const user=await getCurrentUser();
    if(!user)return json({error:'Потрібно увійти.'},401);
    if(!sameOrigin(request))return json({error:'Недійсний запит.'},403);
    const body=await readJsonObject(request,8*1024);
    if(body instanceof Response)return body;
    const now=Math.floor(Date.now()/1000);
    if(body.action==='start')return json(await startWaitingWhatsAppCheck(env.DB,user.id,now));
    if(body.action==='stop'){
      if(!Number.isSafeInteger(body.batchId)||Number(body.batchId)<=0)return json({error:'Некоректний пакет перевірки.'},400);
      return json(await stopWaitingWhatsAppCheck(env.DB,user.id,Number(body.batchId),now));
    }
    return json({error:'Невідома дія.'},400);
  }catch(error){
    console.error('WhatsApp waiting-check action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося запустити перевірку WhatsApp. Спробуйте ще раз.'},500);
  }
}
