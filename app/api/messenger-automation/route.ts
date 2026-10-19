import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { businessDate } from '@/lib/business-time';
import {
  MessengerAutomationError,
  cancelViberSafeNoteJob,
  cancelWhatsAppAutopostBatch,
  cancelWhatsAppAutopostJob,
  createViberSafeNoteJob,
  createAutopostVerifyJob,
  createWhatsAppAutopostBatch,
  createWhatsAppAutopostJob,
  readAutopostPlan,
  readLatestViberSafeNoteJob,
  readLatestWhatsAppAutopostJob,
  readViberSafeNoteJob,
  readWhatsAppAutopostProgress,
  resetWhatsAppAutopostQueue,
} from '@/lib/messenger-automation';
import { readAutopostAttention, resolveAutopostDecision, resolveAutopostDecisions, type AutopostDecision } from '@/lib/messenger-automation-outcome';
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
    const url=new URL(request.url);
    const viberJobId=url.searchParams.get('viberJobId')?.trim()||'';
    if(viberJobId)return json({job:await readViberSafeNoteJob(env.DB,user.id,viberJobId)});
    // The autopost dialog refreshes on every live-channel autopost event, so that path reads one grouped
    // count instead of the image row and the rest of the settings.
    if(url.searchParams.get('progress')==='1'){
      const date=businessDate(Math.floor(Date.now()/1000));
      const [progress,attention]=await Promise.all([
        readWhatsAppAutopostProgress(env.DB,user.id,date),
        readAutopostAttention(env.DB,user.id,'whatsapp',date),
      ]);
      return json({whatsappAutopostProgress:progress,autopostAttention:attention});
    }
    // План запуску: скільки чатів справді піде в партію й чому решта черги не йде (за запитом, без таймера).
    const planPlatform=url.searchParams.get('plan');
    if(planPlatform==='viber'||planPlatform==='whatsapp'){
      const now=Math.floor(Date.now()/1000);
      return json({plan:await readAutopostPlan(env.DB,user.id,planPlatform,now,businessDate(now))});
    }
    // Viber-автопост: лічильники сьогоднішньої партії й чати, що чекають рішення (одна згрупована вибірка й один короткий список).
    if(url.searchParams.get('viber')==='1'){
      const date=businessDate(Math.floor(Date.now()/1000));
      const [progress,attention]=await Promise.all([
        readWhatsAppAutopostProgress(env.DB,user.id,date,'viber'),
        readAutopostAttention(env.DB,user.id,'viber',date),
      ]);
      return json({viberAutopostProgress:progress,autopostAttention:attention});
    }
    const [job,whatsappAutopost,image,caption,progress,attention]=await Promise.all([
      readLatestViberSafeNoteJob(env.DB,user.id),
      readLatestWhatsAppAutopostJob(env.DB,user.id),
      readWhatsAppAutopostImage(env.DB,user.id),
      readWhatsAppAutopostCaption(env.DB,user.id),
      readWhatsAppAutopostProgress(env.DB,user.id,businessDate(Math.floor(Date.now()/1000))),
      readAutopostAttention(env.DB,user.id,'whatsapp',businessDate(Math.floor(Date.now()/1000))),
    ]);
    return json({
      job,
      whatsappAutopost,
      whatsappAutopostImage:image?publicWhatsAppAutopostImage(image):null,
      whatsappAutopostCaption:caption?.text||'',
      whatsappAutopostProgress:progress,
      autopostAttention:attention,
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
      const batch=await createWhatsAppAutopostBatch(env.DB,user.id,{limit:body.limit,caption,exclude:body.exclude},now,businessDate(now));
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id);
      return json(batch);
    }
    // Viber-автопост: та сама черга задач, що й у WhatsApp, але чати Viber, без власного тексту й фото (їх дає нотатка
    // в «Мої нотатки»), виконує помічник на ПК оператора через runner.
    if(body.action==='viber-autopost-batch'){
      const batch=await createWhatsAppAutopostBatch(env.DB,user.id,{limit:body.limit,platform:'viber',exclude:body.exclude},now,businessDate(now));
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id);
      return json(batch);
    }
    if(body.action==='cancel-viber-autopost-batch'){
      const result=await cancelWhatsAppAutopostBatch(env.DB,user.id,businessDate(now),now,'viber');
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now),'viber')});
    }
    if(body.action==='reset-viber-autopost'){
      const result=await resetWhatsAppAutopostQueue(env.DB,user.id,businessDate(now),'viber');
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now),'viber')});
    }
    // Рішення власника зі списку «Потребують рішення»: в архів, відкласти на завтра, спробувати ще раз або «перевірити» (лише
    // відкрити чат і подивитись, чи повідомлення вже є). Те саме для групи чатів одним запитом (`jobIds`).
    if(body.action==='resolve-autopost-decision'||body.action==='resolve-autopost-decisions'){
      const decision=['archive','snooze','retry','check','rename'].includes(String(body.decision))?body.decision as AutopostDecision:null;
      const bulk=body.action==='resolve-autopost-decisions';
      const jobIds=bulk?(Array.isArray(body.jobIds)?body.jobIds.filter((id):id is string=>typeof id==='string'&&id.length>0):[]):(typeof body.jobId==='string'&&body.jobId?[body.jobId]:[]);
      if(!jobIds.length||!decision)throw new MessengerAutomationError('Не вказано чат або рішення.');
      if(decision==='retry'&&bulk)throw new MessengerAutomationError('Повторну відправку для групи не виконуємо: можливі дублі.');
      const date=businessDate(now);
      let resolved:Array<{jobId:string;chatId:string}>;
      if(bulk)resolved=(await resolveAutopostDecisions(env.DB,user.id,{jobIds,decision,requireSimilar:decision==='rename'},now)).resolved;
      else{
        const single=await resolveAutopostDecision(env.DB,user.id,{jobId:jobIds[0],decision},now);
        if(!single.ok)throw new MessengerAutomationError(single.error,409);
        resolved=[{jobId:jobIds[0],chatId:single.chatId}];
      }
      if(decision==='retry'||decision==='rename'){
        for(const item of resolved){
          const platformRow=await env.DB.prepare(`SELECT platform FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(item.chatId,user.id).first<{platform:string}>();
          await createWhatsAppAutopostJob(env.DB,user.id,{requestKey:`retry_${crypto.randomUUID()}`,chatId:item.chatId,platform:platformRow?.platform},now,date);
        }
      }
      if(decision==='check'){
        for(const item of resolved)await createAutopostVerifyJob(env.DB,user.id,item.jobId,now,date);
      }
      if(decision==='retry'||decision==='check'||decision==='rename')await wakeOwnerChannelAutopost(user.id);
      const platform=body.platform==='viber'?'viber':'whatsapp';
      const [progress,attention]=await Promise.all([
        readWhatsAppAutopostProgress(env.DB,user.id,date,platform),
        readAutopostAttention(env.DB,user.id,platform,date),
      ]);
      return json({ok:true,resolved:resolved.length,progress,autopostAttention:attention});
    }
    if(body.action==='cancel-whatsapp-autopost'){
      if(typeof body.jobId!=='string'||!body.jobId)throw new MessengerAutomationError('WhatsApp autopost задача не вказана.');
      const result=await cancelWhatsAppAutopostJob(env.DB,user.id,body.jobId,now);
      await wakeOwnerChannelAutopost(user.id);
      return json(result);
    }
    // «Зупинити» в діалозі автопоста: усе, що ще не відправлено, скасовується одним запитом. Задача, яку
    // runner уже тримає в роботі, теж переходить у cancelled — підтверджена відправка дійде, але нових
    // задач він більше не отримає.
    if(body.action==='cancel-whatsapp-autopost-batch'){
      const result=await cancelWhatsAppAutopostBatch(env.DB,user.id,businessDate(now),now);
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now))});
    }
    // «Скинути»: прибрати сьогоднішню чергу повністю, щоб наступний запуск почався з початку.
    if(body.action==='reset-whatsapp-autopost'){
      const result=await resetWhatsAppAutopostQueue(env.DB,user.id,businessDate(now));
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now))});
    }
    throw new MessengerAutomationError('Невідома messenger automation дія.');
  }catch(error){
    if(error instanceof MessengerAutomationError)return json({error:error.message},error.status);
    console.error('Messenger automation action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Messenger automation операцію не завершено.'},500);
  }
}
