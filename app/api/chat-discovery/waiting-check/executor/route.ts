import { env } from 'cloudflare:workers';
import { readJsonObject } from '@/lib/http-json';
import { DiscoveryError } from '@/lib/chat-discovery/domain';
import { authenticateDiscoveryExecutor } from '@/lib/chat-discovery/executor-auth';
import { claimWaitingWhatsAppCheck, completeWaitingWhatsAppCheck, releaseWaitingWhatsAppCheck, WaitingCheckError } from '@/lib/chats/whatsapp-waiting-check';

const OUTCOMES=new Set(['joined','pending','requested','failed']);

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

function failure(error:unknown,label:string){
  if(error instanceof DiscoveryError||error instanceof WaitingCheckError)return json({error:error.message},error.status);
  console.error(label,error instanceof Error?error.name:'unknown');
  return json({error:'Перевірка WhatsApp зараз недоступна.'},500);
}

export async function GET(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    return json({task:await claimWaitingWhatsAppCheck(env.DB,executor.userId,executor.deviceId,now)});
  }catch(error){
    return failure(error,'WhatsApp waiting-check claim failed');
  }
}

export async function POST(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    const body=await readJsonObject(request,8*1024);
    if(body instanceof Response)return body;
    if(!Number.isSafeInteger(body.batchId)||typeof body.chatId!=='string'||!body.chatId){
      return json({error:'Некоректний результат перевірки.'},400);
    }
    const target={batchId:Number(body.batchId),chatId:body.chatId};
    if(body.action==='release'){
      return json(await releaseWaitingWhatsAppCheck(env.DB,executor.userId,executor.deviceId,target,now));
    }
    if(body.action==='complete'&&OUTCOMES.has(String(body.status))){
      return json(await completeWaitingWhatsAppCheck(env.DB,executor.userId,executor.deviceId,{
        ...target,
        status:body.status as 'joined'|'pending'|'requested'|'failed',
        reason:typeof body.reason==='string'?body.reason:undefined,
        observedName:typeof body.observedName==='string'?body.observedName.slice(0,300):undefined,
      },now));
    }
    return json({error:'Невідома дія.'},400);
  }catch(error){
    return failure(error,'WhatsApp waiting-check result failed');
  }
}
