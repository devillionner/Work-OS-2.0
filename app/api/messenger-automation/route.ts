import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { businessDate } from '@/lib/business-time';
import {
  MessengerAutomationError,
  cancelViberSafeNoteJob,
  cancelWhatsAppAutopostJob,
  createViberSafeNoteJob,
  createWhatsAppAutopostBatch,
  createWhatsAppAutopostJob,
  readLatestViberSafeNoteJob,
  readLatestWhatsAppAutopostJob,
  readViberSafeNoteJob,
} from '@/lib/messenger-automation';
import { publicWhatsAppAutopostImage, readWhatsAppAutopostImage } from '@/lib/whatsapp-autopost-media';
import {
  cleanWhatsAppAutopostCaption,
  deleteWhatsAppAutopostCaption,
  readWhatsAppAutopostCaption,
  saveWhatsAppAutopostCaption,
} from '@/lib/whatsapp-autopost-caption';

function json(value:unknown,status=200){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
}

// WhatsApp autopost claim/complete moved to the owner Durable Object (commit 3c): D1 still holds
// the job rows (read/created/cancelled here as before), but something has to tell the DO a new
// 'pending' row exists so it can push it to a connected runner instead of the runner polling for
// it. A failed wake is non-fatal — the job already exists in D1 and the next natural trigger (a
// runner reconnect) picks it up — so this never fails the request that created/cancelled the job.
async function wakeOwnerChannelAutopost(userId:string){
  try{
    const stub=env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(userId));
    const url=new URL('https://owner-channel/autopost-wake');
    url.searchParams.set('userId',userId);
    await stub.fetch(new Request(url,{method:'POST'}));
  }catch(error){
    console.error('Autopost wake failed',error instanceof Error?error.name:'unknown');
  }
}

export async function GET(request:Request):Promise<Response>{
  const user=await getCurrentUser();
  if(!user)return json({error:'Потрібна авторизація.'},401);
  try{
    const viberJobId=new URL(request.url).searchParams.get('viberJobId')?.trim()||'';
    if(viberJobId)return json({job:await readViberSafeNoteJob(env.DB,user.id,viberJobId)});
    const [job,whatsappAutopost,image,caption]=await Promise.all([
      readLatestViberSafeNoteJob(env.DB,user.id),
      readLatestWhatsAppAutopostJob(env.DB,user.id),
      readWhatsAppAutopostImage(env.DB,user.id),
      readWhatsAppAutopostCaption(env.DB,user.id),
    ]);
    return json({
      job,
      whatsappAutopost,
      whatsappAutopostImage:image?publicWhatsAppAutopostImage(image):null,
      whatsappAutopostCaption:caption?.text||'',
    });
  }
  catch(error){
    console.error('Messenger automation read failed',error instanceof Error?error.name:'unknown');
    return json({error:'Не вдалося прочитати messenger automation стан.'},500);
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
    if(body.action==='save-whatsapp-autopost-caption'){
      let text:string;
      try{text=cleanWhatsAppAutopostCaption(body.text);}
      catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
      const caption=text
        ? await saveWhatsAppAutopostCaption(env.DB,user.id,text,now)
        : (await deleteWhatsAppAutopostCaption(env.DB,user.id),null);
      return json({caption:caption?.text||''});
    }
    if(body.action==='clear-whatsapp-autopost-caption'){
      await deleteWhatsAppAutopostCaption(env.DB,user.id);
      return json({caption:''});
    }
    if(body.action==='whatsapp-autopost'){
      const job=await createWhatsAppAutopostJob(env.DB,user.id,{
        requestKey:body.requestKey,chatId:body.chatId,advertisementId:body.advertisementId,language:body.language,caption:body.caption,
      },now,businessDate(now));
      await wakeOwnerChannelAutopost(user.id);
      return json({job});
    }
    if(body.action==='whatsapp-autopost-batch'){
      let caption:unknown=body.caption;
      if(body.caption!==undefined){
        let cleaned:string;
        try{cleaned=cleanWhatsAppAutopostCaption(body.caption);}
        catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
        if(cleaned)await saveWhatsAppAutopostCaption(env.DB,user.id,cleaned,now);
        else await deleteWhatsAppAutopostCaption(env.DB,user.id);
        caption=cleaned;
      }
      const batch=await createWhatsAppAutopostBatch(env.DB,user.id,{limit:body.limit,caption},now,businessDate(now));
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id);
      return json(batch);
    }
    if(body.action==='cancel-whatsapp-autopost'){
      if(typeof body.jobId!=='string'||!body.jobId)throw new MessengerAutomationError('WhatsApp autopost задача не вказана.');
      const result=await cancelWhatsAppAutopostJob(env.DB,user.id,body.jobId,now);
      await wakeOwnerChannelAutopost(user.id);
      return json(result);
    }
    throw new MessengerAutomationError('Невідома messenger automation дія.');
  }catch(error){
    if(error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Messenger automation action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Messenger automation операцію не завершено.'},500);
  }
}
