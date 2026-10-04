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

// WhatsApp autopost claim/complete moved to the owner Durable Object in commit 3c — the runner will
// reach it over /api/live starting commit 3e. This bridge keeps serving Viber safe-mode exactly as
// before (it still uses the per-device HTTP lease; only WhatsApp autopost was migrated).
export async function GET(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    const url=new URL(request.url);
    if(url.searchParams.get('platform')==='whatsapp')
      return json({error:'WhatsApp autopost тепер координується через /api/live (коміт 3e).'},410);
    return json({task:await claimViberSafeNoteJob(env.DB,executor.userId,executor.deviceId,now)});
  }catch(error){
    if(error instanceof DiscoveryError||error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Messenger automation executor read failed',error instanceof Error?error.name:'unknown');
    return json({error:'Messenger automation executor недоступний.'},500);
  }
}

export async function POST(request:Request):Promise<Response>{
  const now=Math.floor(Date.now()/1000);
  try{
    const executor=await authenticateDiscoveryExecutor(env.DB,request,now);
    const body=await readJsonObject(request,32*1024);
    if(body instanceof Response)return body;
    if(body.action==='complete-viber-safe-note'){
      return json(await completeViberSafeNoteJob(env.DB,executor.userId,executor.deviceId,{
        jobId:body.jobId,status:body.status,observedTarget:body.observedTarget,targetVerified:body.targetVerified,
        sendConfirmed:body.sendConfirmed,errorCode:body.errorCode,
      },now));
    }
    if(body.action==='complete-whatsapp-autopost'){
      return json({error:'WhatsApp autopost тепер координується через /api/live (коміт 3e).'},410);
    }
    throw new MessengerAutomationError('Невідома messenger automation executor дія.');
  }catch(error){
    if(error instanceof DiscoveryError||error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Messenger automation executor callback failed',error instanceof Error?error.name:'unknown');
    return json({error:'Messenger automation executor result не застосовано.'},500);
  }
}
