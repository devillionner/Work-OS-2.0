import { env } from 'cloudflare:workers';
import { readJsonObject } from '@/lib/http-json';
import { DiscoveryError } from '@/lib/chat-discovery/domain';
import { authenticateDiscoveryExecutor } from '@/lib/chat-discovery/executor-auth';
import {
  MessengerAutomationError,
  claimViberSafeNoteJob,
  completeViberSafeNoteJob,
} from '@/lib/messenger-automation';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

export async function GET(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    return json({task:await claimViberSafeNoteJob(env.DB,executor.userId,executor.deviceId,now)});
  }catch(error){
    if(error instanceof DiscoveryError||error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Viber safe executor read failed',error instanceof Error?error.name:'unknown');
    return json({error:'Viber safe executor недоступний.'},500);
  }
}

export async function POST(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    const body=await readJsonObject(request,32*1024);
    if(body instanceof Response)return body;
    if(body.action!=='complete-viber-safe-note')throw new MessengerAutomationError('Невідома Viber safe executor дія.');
    return json(await completeViberSafeNoteJob(env.DB,executor.userId,executor.deviceId,{
      jobId:body.jobId,status:body.status,observedTarget:body.observedTarget,targetVerified:body.targetVerified,
      sendConfirmed:body.sendConfirmed,errorCode:body.errorCode,
    },now));
  }catch(error){
    if(error instanceof DiscoveryError||error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Viber safe executor callback failed',error instanceof Error?error.name:'unknown');
    return json({error:'Viber safe executor result не застосовано.'},500);
  }
}
