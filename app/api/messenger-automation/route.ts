import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { businessDate } from '@/lib/business-time';
import {
  MessengerAutomationError,
  cancelViberSafeNoteJob,
  cleanAutopostPlatform,
  cancelWhatsAppAutopostBatch,
  cancelWhatsAppAutopostJob,
  createViberSafeNoteJob,
  createAutopostVerifyJob,
  cleanKnownBatchId,
  createTelegramScanBatch,
  createTelegramScanJob,
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
import { TelegramAutopostError, bindTelegramWebAccount, chooseTelegramThread, readTelegramThreadState, unbindTelegramWebAccount } from '@/lib/telegram-autopost';
import { resolveTelegramAccount } from '@/lib/chats/telegram-account';
import { deleteWhatsAppAutopostImage, publicWhatsAppAutopostImage, readWhatsAppAutopostImage, saveWhatsAppAutopostImage } from '@/lib/whatsapp-autopost-media';
import {
  TELEGRAM_PHOTO_CAPTION_LIMIT,
  TELEGRAM_TEXT_LIMIT,
  textLength,
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
/** Темп із запиту: 5, 10, 20 чи 30 на годину; 0 («без пауз») лише там, де це дозволено (Viber і WhatsApp). */
function cleanPerHour(value:unknown,allowNoPause:boolean):number{
  const perHour=Number(value);
  if([5,10,20,30].includes(perHour))return perHour;
  return allowNoPause&&perHour===0?0:allowNoPause?0:10;
}

async function wakeOwnerChannelAutopost(userId:string,pace?:{platform:'whatsapp'|'viber'|'telegram';perHour:number}){
  try{
    const stub=env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(userId));
    const url=new URL('https://owner-channel/autopost-wake');
    url.searchParams.set('userId',userId);
    // Темп платформи (відправок на годину, 0 — без пауз): DO розставляє їх рівномірно (інтервал = 3600 / це число).
    if(pace)url.searchParams.set('pace',`${pace.platform}:${pace.perHour}`);
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
    // Партія, яку клієнт уже бачив: так пошук найновішої партії пропускається (економія читань на кожну подію).
    const knownBatch=cleanKnownBatchId(url.searchParams.get('batch'));
    // Чати «Потребують рішення» читаються, лише коли лічильники дня кажуть, що вони є: порожній список не коштує запиту.
    const attentionFor=(progress:{settled?:{decision:number}},platform:'whatsapp'|'viber'|'telegram',date:string)=>
      (progress.settled?.decision||0)>0?readAutopostAttention(env.DB,user.id,platform,date):Promise.resolve([]);
    const viberJobId=url.searchParams.get('viberJobId')?.trim()||'';
    if(viberJobId)return json({job:await readViberSafeNoteJob(env.DB,user.id,viberJobId)});
    // The autopost dialog refreshes on every live-channel autopost event, so that path reads one grouped
    // count instead of the image row and the rest of the settings.
    if(url.searchParams.get('progress')==='1'){
      const date=businessDate(Math.floor(Date.now()/1000));
      const progress=await readWhatsAppAutopostProgress(env.DB,user.id,date,'whatsapp',knownBatch);
      return json({whatsappAutopostProgress:progress,autopostAttention:await attentionFor(progress,'whatsapp',date)});
    }
    // Підсумок дня для картки «Автопост сьогодні»: лічильники дня трьох платформ (кілька рядків autopost_day_counts на платформу) і межі останньої партії.
    if(url.searchParams.get('summary')==='1'){
      const date=businessDate(Math.floor(Date.now()/1000));
      const platforms=['whatsapp','viber','telegram'] as const;
      const progress=await Promise.all(platforms.map(platform=>readWhatsAppAutopostProgress(env.DB,user.id,date,platform)));
      return json({summary:{date,platforms:platforms.map((platform,index)=>{
        const p=progress[index];
        return {platform,total:p.total,sent:p.sent,failed:p.failed,pending:p.pending,claimed:p.claimed,running:p.running,settled:p.settled,
          startedAt:p.batch?.startedAt??null,lastAt:p.batch?.entries[0]?.at??null};
      })}});
    }
    // План запуску: скільки чатів справді піде в партію й чому решта черги не йде (за запитом, без таймера).
    const planPlatform=url.searchParams.get('plan');
    if(planPlatform==='viber'||planPlatform==='whatsapp'){
      const now=Math.floor(Date.now()/1000);
      return json({plan:await readAutopostPlan(env.DB,user.id,planPlatform,now,businessDate(now))});
    }
    // Гілка одного чату Telegram: форум чи ні, вибрана гілка й список (закриті позначені), для «Профіль і правила».
    const threadChat=url.searchParams.get('telegramThread')?.trim()||'';
    if(threadChat)return json({thread:await readTelegramThreadState(env.DB,user.id,threadChat)});
    // Telegram: усе по вибраному акаунту (чати, гілки, прив'язка до браузера).
    if(planPlatform==='telegram'||url.searchParams.get('telegram')==='1'){
      const now=Math.floor(Date.now()/1000);
      const accountId=await resolveTelegramAccount(env.DB,user.id,url.searchParams.get('account'),now);
      if(!accountId)return json({error:'Додай або увімкни Telegram-акаунт.'},409);
      const date=businessDate(now);
      if(planPlatform==='telegram')return json({plan:await readAutopostPlan(env.DB,user.id,'telegram',now,date,accountId)});
      // `light=1` — перечитування після події: власні фото й текст змінює лише власник, їх не читаємо.
      const light=url.searchParams.get('light')==='1';
      const [telegramImage,telegramCaption]=light?[null,null]:await Promise.all([readWhatsAppAutopostImage(env.DB,user.id,false,'telegram'),readWhatsAppAutopostCaption(env.DB,user.id,'telegram')]);
      const [progress,account]=await Promise.all([
        readWhatsAppAutopostProgress(env.DB,user.id,date,'telegram',knownBatch),
        env.DB.prepare(`SELECT id,name,web_user_id FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(accountId,user.id).first<{id:string;name:string;web_user_id:string|null}>(),
      ]);
      return json({...(light?{}:{telegramMaterial:{image:telegramImage?publicWhatsAppAutopostImage(telegramImage):null,caption:telegramCaption?.text||''}}),telegramAutopostProgress:progress,autopostAttention:await attentionFor(progress,'telegram',date),telegramAccount:account?{id:account.id,name:account.name,bound:Boolean(account.web_user_id),webUserId:account.web_user_id}:null});
    }
    // Viber-автопост: лічильники сьогоднішньої партії й чати, що чекають рішення (одна згрупована вибірка й один короткий список).
    if(url.searchParams.get('viber')==='1'){
      const date=businessDate(Math.floor(Date.now()/1000));
      const progress=await readWhatsAppAutopostProgress(env.DB,user.id,date,'viber',knownBatch);
      return json({viberAutopostProgress:progress,autopostAttention:await attentionFor(progress,'viber',date)});
    }
    const today=businessDate(Math.floor(Date.now()/1000));
    const [job,whatsappAutopost,image,caption,progress]=await Promise.all([
      readLatestViberSafeNoteJob(env.DB,user.id),
      readLatestWhatsAppAutopostJob(env.DB,user.id),
      readWhatsAppAutopostImage(env.DB,user.id),
      readWhatsAppAutopostCaption(env.DB,user.id),
      readWhatsAppAutopostProgress(env.DB,user.id,today,'whatsapp',knownBatch),
    ]);
    const attention=await attentionFor(progress,'whatsapp',today);
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
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id,{platform:'whatsapp',perHour:cleanPerHour(body.perHour,true)});
      return json(batch);
    }
    // Viber-автопост: та сама черга задач, що й у WhatsApp, але чати Viber, без власного тексту й фото (їх дає нотатка
    // в «Мої нотатки»), виконує помічник на ПК оператора через runner.
    if(body.action==='viber-autopost-batch'){
      const batch=await createWhatsAppAutopostBatch(env.DB,user.id,{limit:body.limit,platform:'viber',exclude:body.exclude},now,businessDate(now));
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id,{platform:'viber',perHour:cleanPerHour(body.perHour,true)});
      return json(batch);
    }
    // Telegram-автопост: та сама черга, але лише чати вибраного акаунта, публікації розставляє DO рівномірно (5, 10 чи 20 на годину).
    if(body.action==='telegram-autopost-batch'){
      const accountId=await resolveTelegramAccount(env.DB,user.id,typeof body.accountId==='string'?body.accountId:null,now);
      if(!accountId)throw new MessengerAutomationError('Додай або увімкни Telegram-акаунт.',409,'account_missing');
      const perHour=cleanPerHour(body.perHour,false);
      const batch=await createWhatsAppAutopostBatch(env.DB,user.id,{limit:body.limit,platform:'telegram',exclude:body.exclude,telegramAccountId:accountId},now,businessDate(now));
      if(batch.created>0)await wakeOwnerChannelAutopost(user.id,{platform:'telegram',perHour});
      return json(batch);
    }
    if(body.action==='cancel-telegram-autopost-batch'){
      const result=await cancelWhatsAppAutopostBatch(env.DB,user.id,businessDate(now),now,'telegram');
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now),'telegram')});
    }
    if(body.action==='reset-telegram-autopost'){
      const result=await resetWhatsAppAutopostQueue(env.DB,user.id,businessDate(now),'telegram');
      await wakeOwnerChannelAutopost(user.id);
      return json({...result,progress:await readWhatsAppAutopostProgress(env.DB,user.id,businessDate(now),'telegram')});
    }
    // Власні фото й текст Telegram (окремі від WhatsApp і Viber). З фото підпис до 1024 символів, без фото текст до 4096; довший не зберігається.
    if(body.action==='save-telegram-autopost-caption'){
      let text:string;
      try{text=cleanWhatsAppAutopostCaption(body.text);}
      catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
      const hasPhoto=Boolean(await readWhatsAppAutopostImage(env.DB,user.id,false,'telegram'));
      const limit=hasPhoto?TELEGRAM_PHOTO_CAPTION_LIMIT:TELEGRAM_TEXT_LIMIT;
      if(textLength(text)>limit)throw new MessengerAutomationError(hasPhoto?`Підпис до фото в Telegram — до ${limit} символів, а в тексті ${textLength(text)}. Скороти текст або прибери фото.`:`Текст у Telegram — до ${limit} символів, а в тексті ${textLength(text)}.`,409,'too_long');
      const caption=text?await saveWhatsAppAutopostCaption(env.DB,user.id,text,now,'telegram'):(await deleteWhatsAppAutopostCaption(env.DB,user.id,'telegram'),null);
      return json({caption:caption?.text||''});
    }
    if(body.action==='clear-telegram-autopost-caption'){
      await deleteWhatsAppAutopostCaption(env.DB,user.id,'telegram');
      return json({caption:''});
    }
    // «Взяти з WhatsApp/Viber»: копія їхніх фото й тексту в Telegram. Вихід за ліміт підпису до фото не обрізаємо, а пояснюємо.
    if(body.action==='copy-telegram-material-from-shared'){
      const [image,caption]=await Promise.all([readWhatsAppAutopostImage(env.DB,user.id,true,'shared'),readWhatsAppAutopostCaption(env.DB,user.id,'shared')]);
      if(!image&&!caption)throw new MessengerAutomationError('У WhatsApp і Viber ще немає ні фото, ні власного тексту.',409,'nothing_to_copy');
      const text=caption?.text||'';
      if(image&&textLength(text)>TELEGRAM_PHOTO_CAPTION_LIMIT)throw new MessengerAutomationError(`Текст WhatsApp і Viber (${textLength(text)} символів) задовгий для підпису до фото в Telegram (до ${TELEGRAM_PHOTO_CAPTION_LIMIT}). Скороти його там або напиши окремий текст тут.`,409,'too_long');
      if(!image&&textLength(text)>TELEGRAM_TEXT_LIMIT)throw new MessengerAutomationError(`Текст довший за ліміт Telegram (${TELEGRAM_TEXT_LIMIT}).`,409,'too_long');
      let savedImage=null;
      if(image){
        const binary=atob(image.base64);
        const bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
        savedImage=await saveWhatsAppAutopostImage(env.DB,user.id,{fileName:image.fileName,contentType:image.contentType,bytes},now,'telegram');
      }else await deleteWhatsAppAutopostImage(env.DB,user.id,'telegram');
      if(text)await saveWhatsAppAutopostCaption(env.DB,user.id,text,now,'telegram');
      else await deleteWhatsAppAutopostCaption(env.DB,user.id,'telegram');
      return json({image:savedImage,caption:text});
    }
    // Кнопка «Знайти гілки»: прохід по чатах, про які невідомо, чи є в них гілки, і по чатах, що чекають вибору гілки (оновити список).
    // Проходи не займають вікон «N на годину» й не рахуються спробами.
    if(body.action==='telegram-scan-threads'){
      const accountId=await resolveTelegramAccount(env.DB,user.id,typeof body.accountId==='string'?body.accountId:null,now);
      if(!accountId)throw new MessengerAutomationError('Додай або увімкни Telegram-акаунт.',409,'account_missing');
      // «Перевірити гілки ще раз» у рядку чату: прохід лише для цього чату (разом із форумами, де вибрано гілку).
      const oneChat=typeof body.chatId==='string'?body.chatId.trim():'';
      let result:{created:number;skipped:number};
      if(oneChat){
        try{await createTelegramScanJob(env.DB,user.id,oneChat,accountId,now,businessDate(now),null);result={created:1,skipped:0};}
        catch(error){
          if(!(error instanceof MessengerAutomationError&&[404,409].includes(error.status)))throw error;
          result={created:0,skipped:1};
        }
      }else result=await createTelegramScanBatch(env.DB,user.id,accountId,now,businessDate(now));
      if(result.created>0)await wakeOwnerChannelAutopost(user.id);
      return json(result);
    }
    // Власник вибрав гілку форуму (або прибрав вибір). Якщо чат сьогодні чекав саме гілки, він одразу стає в чергу.
    if(body.action==='telegram-choose-thread'){
      const chatId=typeof body.chatId==='string'?body.chatId:'';
      if(!chatId)throw new MessengerAutomationError('Чат не вказано.');
      const state=await chooseTelegramThread(env.DB,user.id,chatId,body.threadId);
      let queued=false;
      if(state.thread){
        const date=businessDate(now);
        const waiting=await env.DB.prepare(`SELECT id,json_extract(result_json,'$.errorCode') AS code FROM whatsapp_autopost_jobs
          WHERE user_id=?1 AND chat_id=?2 AND outcome IN ('needs_decision','needs_thread') AND published_on=?3`).bind(user.id,chatId,date).all<{id:string;code:string|null}>();
        for(const job of waiting.results||[]){
          if(job.code!=='thread_required'&&job.code!=='thread_closed')continue;
          const resolved=await resolveAutopostDecision(env.DB,user.id,{jobId:job.id,decision:'retry'},now);
          if(!resolved.ok)continue;
          await createWhatsAppAutopostJob(env.DB,user.id,{requestKey:`retry_${crypto.randomUUID()}`,chatId,platform:'telegram'},now,date);
          queued=true;
        }
        if(queued)await wakeOwnerChannelAutopost(user.id);
      }
      return json({ok:true,thread:state.thread,queued});
    }
    // Прив'язка акаунта Work OS до акаунта, залогіненого в Telegram Web runner: id приходить зі стану runner, оператор підтверджує кнопкою.
    if(body.action==='telegram-bind-account'){
      const accountId=await resolveTelegramAccount(env.DB,user.id,typeof body.accountId==='string'?body.accountId:null,now);
      if(!accountId)throw new MessengerAutomationError('Додай або увімкни Telegram-акаунт.',409,'account_missing');
      if(body.unbind===true){await unbindTelegramWebAccount(env.DB,user.id,accountId,now);await wakeOwnerChannelAutopost(user.id);return json({ok:true,bound:false});}
      await bindTelegramWebAccount(env.DB,user.id,accountId,body.webUserId,now);
      await wakeOwnerChannelAutopost(user.id);
      return json({ok:true,bound:true});
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
      const date=businessDate(now);
      let resolved:Array<{jobId:string;chatId:string}>;
      if(bulk)// Повторна відправка для групи лише там, де перевірка вже показала, що повідомлення в чаті немає (дубля не буде).
        resolved=(await resolveAutopostDecisions(env.DB,user.id,{jobIds,decision,requireSimilar:decision==='rename',requireCode:decision==='retry'?'message_not_found':undefined},now)).resolved;
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
      const platform=cleanAutopostPlatform(body.platform);
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
    if(error instanceof MessengerAutomationError||error instanceof TelegramAutopostError)return json({error:error.message},error.status);
    console.error('Messenger automation action failed',error instanceof Error?error.name:'unknown');
    return json({error:'Messenger automation операцію не завершено.'},500);
  }
}
