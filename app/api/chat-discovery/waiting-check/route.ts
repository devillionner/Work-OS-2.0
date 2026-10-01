import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { readWaitingWhatsAppCheckStatus, startWaitingWhatsAppCheck, stopWaitingWhatsAppCheck, WaitingCheckError } from '@/lib/chats/whatsapp-waiting-check';

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
    if(body.action==='retry_problems')return json(await startWaitingWhatsAppCheck(env.DB,user.id,now,{onlyProblems:true}));
    if(body.action==='stop')return json(await stopWaitingWhatsAppCheck(env.DB,user.id,now));
    return json({error:'Невідома дія.'},400);
  }catch(error){
    if(error instanceof WaitingCheckError)return json({error:error.message},error.status);
    console.error('WhatsApp waiting-check action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося запустити перевірку WhatsApp. Спробуйте ще раз.'},500);
  }
}
