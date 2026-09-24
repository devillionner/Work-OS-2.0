import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  MessengerAutomationError,
  cancelViberSafeNoteJob,
  createViberSafeNoteJob,
  readLatestViberSafeNoteJob,
} from '@/lib/messenger-automation';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

export async function GET():Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return json({error:'Потрібна авторизація.'},401);
  try{return json({job:await readLatestViberSafeNoteJob(env.DB,user.id)});}
  catch(error){
    console.error('Messenger automation read failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося прочитати safe-mode стан.'},500);
  }
}

export async function POST(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return json({error:'Потрібна авторизація.'},401);
  if(!sameOrigin(request))return json({error:'Недійсне джерело запиту.'},403);
  const body=await readJsonObject(request,64*1024);
  if(body instanceof Response)return body;
  const now=Math.floor(Date.now()/1000);
  try{
    if(body.action==='viber-safe-note'){
      return json({job:await createViberSafeNoteJob(env.DB,user.id,{
        requestKey:body.requestKey,advertisementId:body.advertisementId,language:body.language,
      },now)});
    }
    if(body.action==='cancel-viber-safe-note'){
      if(typeof body.jobId!=='string'||!body.jobId)throw new MessengerAutomationError('Viber safe-mode задача не вказана.');
      return json(await cancelViberSafeNoteJob(env.DB,user.id,body.jobId,now));
    }
    throw new MessengerAutomationError('Невідома safe-mode дія.');
  }catch(error){
    if(error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Messenger automation action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Safe-mode операцію не завершено.'},500);
  }
}
