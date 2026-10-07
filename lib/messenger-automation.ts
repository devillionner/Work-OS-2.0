import { cleanLibraryPlatforms } from './library.ts';
import { readPublicationAdvertisementSelection } from './chats/advertisement-selection.ts';
import { publicationAvailability, recordConfirmedWhatsappAutopostPublication } from './chats/publication.ts';
import { readChatState } from './chats/state.ts';
import { readWhatsAppAutopostImage } from './whatsapp-autopost-media.ts';
import { cleanWhatsAppAutopostCaption, readWhatsAppAutopostCaption } from './whatsapp-autopost-caption.ts';

const VIBER_SAFE_LEASE_SECONDS=90;
const WHATSAPP_CUSTOM_AUTOPOST_TITLE='[Системний] WhatsApp автопост · власний текст';

function customWhatsAppAutopostMaterialId(userId:string){
  return 'wa_autopost_custom_'+userId;
}

async function ensureCustomWhatsAppAutopostMaterial(db:D1Database,userId:string,text:string,now:number){
  const id=customWhatsAppAutopostMaterialId(userId);
  const existing=await db.prepare(`SELECT version,uk_text FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(id,userId).first<{version:number;uk_text:string}>();
  if(!existing){
    await db.prepare(`INSERT INTO library_items
      (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at)
      VALUES (?1,?2,'advertisement','advertisement',1,?3,?4,'','Системний material для власного WhatsApp autopost caption.','["system","whatsapp-autopost"]','["whatsapp"]',?5,?5,?5)`)
      .bind(id,userId,WHATSAPP_CUSTOM_AUTOPOST_TITLE,text,now).run();
    return {id,version:1};
  }
  if(existing.uk_text!==text){
    await db.prepare(`UPDATE library_items
      SET uk_text=?1,ru_text='',title=?2,notes='Системний material для власного WhatsApp autopost caption.',
        tags_json='["system","whatsapp-autopost"]',platforms_json='["whatsapp"]',archived_at=?3,
        version=version+1,updated_at=?3
      WHERE id=?4 AND user_id=?5`).bind(text,WHATSAPP_CUSTOM_AUTOPOST_TITLE,now,id,userId).run();
    return {id,version:Number(existing.version)+1};
  }
  await db.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3`)
    .bind(now,id,userId).run();
  return {id,version:Number(existing.version)};
}

export class MessengerAutomationError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.name='MessengerAutomationError';this.status=status;}
}

export type ViberSafeNoteJob={
  id:string;
  requestKey:string;
  advertisementId:string;
  advertisementVersion:number;
  language:'uk'|'ru';
  status:'pending'|'claimed'|'sent'|'failed'|'cancelled';
  createdAt:number;
  updatedAt:number;
  completedAt:number|null;
  result:Record<string,unknown>|null;
};

export type ViberSafeNoteTask={
  kind:'viber_safe_note';
  jobId:string;
  target:{kind:'my_notes';expectedLabel:'Мої нотатки'};
  material:{advertisementId:string;advertisementVersion:number;language:'uk'|'ru';text:string};
  safety:{createsPublication:false;requiresTargetVerification:true;requiresSendConfirmation:true};
  leaseExpiresAt:number;
};

type JobRow={
  id:string;request_key:string;advertisement_id:string;advertisement_version:number;language:'uk'|'ru';
  payload_text:string;status:ViberSafeNoteJob['status'];executor_device_id:string|null;lease_expires_at:number|null;
  result_json:string|null;created_at:number;updated_at:number;completed_at:number|null;
};

export async function createViberSafeNoteJob(db:D1Database,userId:string,input:{
  requestKey:unknown;advertisementId:unknown;language:unknown;
},now:number):Promise<ViberSafeNoteJob>{
  const requestKey=cleanRequestKey(input.requestKey);
  const advertisementId=typeof input.advertisementId==='string'?input.advertisementId.trim():'';
  const language=input.language==='uk'||input.language==='ru'?input.language:null;
  if(!requestKey||!advertisementId||!language)throw new MessengerAutomationError('Некоректний Viber safe-mode запит.');

  const existing=await db.prepare(`SELECT * FROM messenger_automation_jobs
    WHERE user_id=?1 AND request_key=?2 LIMIT 1`).bind(userId,requestKey).first<JobRow>();
  if(existing)return publicJob(existing);

  const item=await db.prepare(`SELECT id,version,uk_text,ru_text,platforms_json
    FROM library_items
    WHERE id=?1 AND user_id=?2 AND kind='advertisement' AND archived_at IS NULL LIMIT 1`)
    .bind(advertisementId,userId).first<{id:string;version:number;uk_text:string;ru_text:string;platforms_json:string}>();
  if(!item)throw new MessengerAutomationError('Оголошення не знайдено або воно в архіві.',404);
  const platforms=parseList(item.platforms_json);
  const canonicalPlatforms=cleanLibraryPlatforms(platforms);
  if(platforms.length&& !canonicalPlatforms.includes('viber'))
    throw new MessengerAutomationError('Це оголошення не дозволене для Viber.',409);
  const payload=(language==='uk'?item.uk_text:item.ru_text).trim();
  if(!payload)throw new MessengerAutomationError(`Для ${language.toUpperCase()} немає тексту оголошення.`,409);

  const id=crypto.randomUUID();
  const activeKey=`${userId}:viber:safe_note`;
  try{
    await db.prepare(`INSERT INTO messenger_automation_jobs
      (id,user_id,request_key,platform,mode,target_key,advertisement_id,advertisement_version,language,payload_text,status,active_key,created_at,updated_at)
      VALUES (?1,?2,?3,'viber','safe_note','my_notes',?4,?5,?6,?7,'pending',?8,?9,?9)`)
      .bind(id,userId,requestKey,item.id,Number(item.version),language,payload,activeKey,now).run();
  }catch(error){
    const active=await readActiveViberSafeNoteJob(db,userId);
    if(active)throw new MessengerAutomationError('Уже є активний Viber safe-mode тест. Завершіть або скасуйте його.',409);
    throw error;
  }
  const created=await readJobRow(db,userId,id);
  if(!created)throw new MessengerAutomationError('Не вдалося створити Viber safe-mode задачу.',409);
  return publicJob(created);
}

export async function readLatestViberSafeNoteJob(db:D1Database,userId:string):Promise<ViberSafeNoteJob|null>{
  const row=await db.prepare(`SELECT * FROM messenger_automation_jobs
    WHERE user_id=?1 AND platform='viber' AND mode='safe_note'
    ORDER BY created_at DESC,id DESC LIMIT 1`).bind(userId).first<JobRow>();
  return row?publicJob(row):null;
}

export async function readViberSafeNoteJob(db:D1Database,userId:string,jobId:string):Promise<ViberSafeNoteJob|null>{
  const id=jobId.trim();
  if(!id)return null;
  const row=await db.prepare(`SELECT * FROM messenger_automation_jobs
    WHERE id=?1 AND user_id=?2 AND platform='viber' AND mode='safe_note' LIMIT 1`)
    .bind(id,userId).first<JobRow>();
  return row?publicJob(row):null;
}

export async function readActiveViberSafeNoteJob(db:D1Database,userId:string):Promise<ViberSafeNoteJob|null>{
  const row=await db.prepare(`SELECT * FROM messenger_automation_jobs
    WHERE user_id=?1 AND active_key=?2 AND status IN ('pending','claimed') LIMIT 1`)
    .bind(userId,`${userId}:viber:safe_note`).first<JobRow>();
  return row?publicJob(row):null;
}

export async function cancelViberSafeNoteJob(db:D1Database,userId:string,jobId:string,now:number){
  const result=await db.prepare(`UPDATE messenger_automation_jobs
    SET status='cancelled',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,updated_at=?1,completed_at=?1
    WHERE id=?2 AND user_id=?3 AND status IN ('pending','claimed')`).bind(now,jobId,userId).run();
  if(Number(result.meta.changes||0)!==1)throw new MessengerAutomationError('Активну Viber safe-mode задачу не знайдено.',409);
  return {ok:true};
}

export async function claimViberSafeNoteJob(db:D1Database,userId:string,deviceId:string,now:number):Promise<ViberSafeNoteTask|null>{
  const candidate=await db.prepare(`SELECT * FROM messenger_automation_jobs
    WHERE user_id=?1 AND platform='viber' AND mode='safe_note'
      AND (status='pending' OR (status='claimed' AND lease_expires_at<=?2))
    ORDER BY created_at,id LIMIT 1`).bind(userId,now).first<JobRow>();
  if(!candidate)return null;
  const leaseExpiresAt=now+VIBER_SAFE_LEASE_SECONDS;
  const claimed=await db.prepare(`UPDATE messenger_automation_jobs
    SET status='claimed',executor_device_id=?1,lease_expires_at=?2,updated_at=?3
    WHERE id=?4 AND user_id=?5
      AND (status='pending' OR (status='claimed' AND lease_expires_at<=?3))`)
    .bind(deviceId,leaseExpiresAt,now,candidate.id,userId).run();
  if(Number(claimed.meta.changes||0)!==1)return null;
  const row=await readJobRow(db,userId,candidate.id);
  if(!row)return null;
  return {
    kind:'viber_safe_note',
    jobId:row.id,
    target:{kind:'my_notes',expectedLabel:'Мої нотатки'},
    material:{advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),language:row.language,text:row.payload_text},
    safety:{createsPublication:false,requiresTargetVerification:true,requiresSendConfirmation:true},
    leaseExpiresAt,
  };
}

export async function completeViberSafeNoteJob(db:D1Database,userId:string,deviceId:string,input:{
  jobId:unknown;status:unknown;observedTarget:unknown;targetVerified:unknown;sendConfirmed:unknown;errorCode?:unknown;
},now:number){
  const jobId=typeof input.jobId==='string'?input.jobId.trim():'';
  if(!jobId)throw new MessengerAutomationError('Viber safe-mode задача не вказана.');
  const row=await readJobRow(db,userId,jobId);
  if(!row||row.status!=='claimed'||row.executor_device_id!==deviceId||!row.lease_expires_at||row.lease_expires_at<=now)
    throw new MessengerAutomationError('Viber safe-mode lease вже не належить цьому executor.',409);

  const requestedSent=input.status==='sent';
  const targetVerified=input.targetVerified===true;
  const sendConfirmed=input.sendConfirmed===true;
  const observedTarget=input.observedTarget==='my_notes'?'my_notes':input.observedTarget==='other'?'other':'unknown';
  const sent=requestedSent&&targetVerified&&sendConfirmed&&observedTarget==='my_notes';
  const errorCode=sent?null:cleanErrorCode(input.errorCode)||(
    observedTarget!=='my_notes'?'target_not_verified':!targetVerified?'target_not_verified':!sendConfirmed?'send_not_confirmed':'adapter_failed'
  );
  const result={requestedStatus:requestedSent?'sent':'failed',observedTarget,targetVerified,sendConfirmed,errorCode};
  const update=await db.prepare(`UPDATE messenger_automation_jobs
    SET status=?1,active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,result_json=?2,updated_at=?3,completed_at=?3
    WHERE id=?4 AND user_id=?5 AND status='claimed' AND executor_device_id=?6
      AND lease_expires_at>?3`)
    .bind(sent?'sent':'failed',JSON.stringify(result),now,jobId,userId,deviceId).run();
  if(Number(update.meta.changes||0)!==1)throw new MessengerAutomationError('Viber safe-mode результат уже змінився.',409);
  return {ok:true,status:sent?'sent':'failed',createsPublication:false,result};
}

export async function releaseViberSafeJobsForDevice(db:D1Database,userId:string,deviceId:string,now:number){
  await db.prepare(`UPDATE messenger_automation_jobs
    SET status='pending',executor_device_id=NULL,lease_expires_at=NULL,updated_at=?1
    WHERE user_id=?2 AND executor_device_id=?3 AND status='claimed'`).bind(now,userId,deviceId).run();
}


export type WhatsAppAutopostJob={
  id:string;requestKey:string;chatId:string;expectedName:string;expectedLink:string;
  advertisementId:string;advertisementVersion:number;language:'uk'|'ru';publishedOn:string;
  status:'pending'|'claimed'|'sent'|'failed'|'cancelled';publicationId:string|null;
  createdAt:number;updatedAt:number;completedAt:number|null;result:Record<string,unknown>|null;
};

export type WhatsAppAutopostTask={
  kind:'whatsapp_autopost';
  jobId:string;
  /** Where this job sits in today's batch, so the runner tray can show «3 / 30» like Discovery does. */
  progress?:WhatsAppAutopostProgress;
  target:{chatId:string;expectedName:string;expectedLink:string};
  material:{
    advertisementId:string;advertisementVersion:number;language:'uk'|'ru';text:string;
    media:{fileName:string;contentType:string;sizeBytes:number;sha256:string;base64:string}|null;
  };
  publishedOn:string;
  safety:{createsPublication:'after_confirmed_send';requiresTargetVerification:true;requiresSendConfirmation:true};
};

type WhatsAppAutopostRow={
  id:string;request_key:string;chat_id:string;expected_name:string;expected_link:string;chat_state_token:string;
  advertisement_id:string;advertisement_version:number;language:'uk'|'ru';payload_text:string;published_on:string;
  status:WhatsAppAutopostJob['status'];active_key:string|null;executor_device_id:string|null;lease_expires_at:number|null;
  result_json:string|null;publication_id:string|null;created_at:number;updated_at:number;completed_at:number|null;
};

export async function createWhatsAppAutopostJob(db:D1Database,userId:string,input:{
  requestKey:unknown;chatId:unknown;advertisementId?:unknown;language?:unknown;caption?:unknown;
},now:number,date:string):Promise<WhatsAppAutopostJob>{
  const requestKey=cleanRequestKey(input.requestKey);
  const chatId=typeof input.chatId==='string'?input.chatId.trim():'';
  if(!requestKey||!chatId)throw new MessengerAutomationError('Некоректний WhatsApp autopost запит.');

  const existing=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND request_key=?2 LIMIT 1`).bind(userId,requestKey).first<WhatsAppAutopostRow>();
  if(existing)return publicWhatsAppAutopostJob(existing);

  const chat=await readChatState(db,userId,chatId);
  if(!chat||chat.platform!=='whatsapp')throw new MessengerAutomationError('WhatsApp-чат не знайдено.',404);
  const availability=publicationAvailability(chat,now);
  if(!availability.availableNow)throw new MessengerAutomationError(
    chat.workflow_status!=='ready'?'Чат зараз не в черзі публікації.':'Чат відкладено; автопублікація зараз недоступна.',409
  );
  const discovery=await db.prepare(`SELECT decision FROM chat_discovery_candidates
    WHERE user_id=?1 AND imported_chat_id=?2 AND id NOT LIKE 'waiting-%' ORDER BY updated_at DESC,id LIMIT 1`)
    .bind(userId,chatId).first<{decision:string}>();
  if(discovery&&discovery.decision!=='target')throw new MessengerAutomationError('Чат із Discovery ще не підтверджений як target.',409);
  const published=await db.prepare(`SELECT id FROM chat_publications
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,chatId,date).first<{id:string}>();
  if(published)throw new MessengerAutomationError('У цьому чаті сьогодні вже є підтверджена публікація.',409);

  const selection=await readPublicationAdvertisementSelection(db,{userId,chatId,date});
  if(!selection)throw new MessengerAutomationError('Не вдалося перевірити правила публікації для цього чату.',409);
  if(!selection.publicationAllowed)throw new MessengerAutomationError(selection.publicationReason||'Публікація зараз заборонена правилами профілю.',409);

  let captionOverride='';
  if(input.caption!==undefined){
    try{captionOverride=cleanWhatsAppAutopostCaption(input.caption);}
    catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
  }else captionOverride=(await readWhatsAppAutopostCaption(db,userId))?.text||'';

  const requestedLanguage=input.language==='uk'||input.language==='ru'?input.language:null;
  let materialId='';
  let materialVersion=0;
  let language:'uk'|'ru';
  let payload='';

  if(captionOverride){
    const custom=await ensureCustomWhatsAppAutopostMaterial(db,userId,captionOverride,now);
    materialId=custom.id;
    materialVersion=custom.version;
    language=requestedLanguage||selection.profileLanguage||'uk';
    payload=captionOverride;
  }else{
    const requestedId=typeof input.advertisementId==='string'?input.advertisementId.trim():'';
    const item=requestedId
      ? selection.items.find(candidate=>candidate.id===requestedId&&candidate.selectable)
      : selection.items.find(candidate=>candidate.recommended&&candidate.selectable)
        ||selection.items.find(candidate=>candidate.selectable&&candidate.directionMatch!=='other')
        ||selection.items.find(candidate=>candidate.selectable);
    if(!item)throw new MessengerAutomationError('Немає придатного невикористаного оголошення для автопублікації.',409);
    language=requestedLanguage||item.suggestedLanguage||selection.profileLanguage||(item.ukText.trim()?'uk':item.ruText.trim()?'ru':null as never);
    if(!language)throw new MessengerAutomationError('Для вибраного оголошення немає тексту.',409);
    const libraryPayload=(language==='uk'?item.ukText:item.ruText).trim();
    if(!libraryPayload)throw new MessengerAutomationError(`Для ${language.toUpperCase()} немає тексту оголошення.`,409);
    const library=await db.prepare(`SELECT version FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`)
      .bind(item.id,userId).first<{version:number}>();
    if(!library)throw new MessengerAutomationError('Library material уже змінився.',409);
    materialId=item.id;
    materialVersion=Number(library.version);
    payload=libraryPayload;
  }

  const id=crypto.randomUUID();
  const activeKey=`${userId}:whatsapp:autopost:${chatId}:${date}`;
  try{
    await db.prepare(`INSERT INTO whatsapp_autopost_jobs
      (id,user_id,request_key,chat_id,expected_name,expected_link,chat_state_token,
       advertisement_id,advertisement_version,language,payload_text,published_on,status,active_key,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pending',?13,?14,?14)`)
      .bind(id,userId,requestKey,chatId,chat.name,chat.link,chat.state_token,materialId,materialVersion,language,payload,date,activeKey,now).run();
  }catch(error){
    const active=await readActiveWhatsAppAutopostJob(db,userId,chatId,date);
    if(active)throw new MessengerAutomationError('Для цього чату вже є активна WhatsApp автопублікація.',409);
    throw error;
  }
  const created=await readWhatsAppAutopostRow(db,userId,id);
  if(!created)throw new MessengerAutomationError('Не вдалося створити WhatsApp autopost задачу.',409);
  return publicWhatsAppAutopostJob(created);
}

export async function createWhatsAppAutopostBatch(
  db:D1Database,
  userId:string,
  input:{limit?:unknown;caption?:unknown},
  now:number,
  date:string,
):Promise<{created:number;skipped:number;jobs:WhatsAppAutopostJob[]}>{
  const rawLimit=Number(input.limit);
  const limit=Number.isSafeInteger(rawLimit)?Math.max(1,Math.min(50,rawLimit)):30;
  let caption='';
  if(input.caption!==undefined){
    try{caption=cleanWhatsAppAutopostCaption(input.caption);}
    catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
  }else caption=(await readWhatsAppAutopostCaption(db,userId))?.text||'';
  const rows=await db.prepare(`SELECT c.id
    FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='ready'
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?2)
      AND NOT EXISTS(SELECT 1 FROM chat_publications p
        WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?3)
      AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j
        WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status IN ('pending','claimed'))
      AND NOT EXISTS(SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target' AND dc.id NOT LIKE 'waiting-%')
    ORDER BY c.updated_at DESC,c.id
    LIMIT ?4`).bind(userId,now,date,Math.min(200,limit*4)).all<{id:string}>();

  const jobs:WhatsAppAutopostJob[]=[];
  let skipped=0;
  for(const row of rows.results){
    if(jobs.length>=limit)break;
    try{
      const job=await createWhatsAppAutopostJob(db,userId,{
        requestKey:`batch_${crypto.randomUUID()}`,
        chatId:row.id,
        caption,
      },now,date);
      jobs.push(job);
    }catch(error){
      if(error instanceof MessengerAutomationError&&[404,409].includes(error.status)){
        skipped+=1;
        continue;
      }
      throw error;
    }
  }
  return {created:jobs.length,skipped,jobs};
}

export async function readLatestWhatsAppAutopostJob(db:D1Database,userId:string):Promise<WhatsAppAutopostJob|null>{
  const row=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
    WHERE user_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1`).bind(userId).first<WhatsAppAutopostRow>();
  return row?publicWhatsAppAutopostJob(row):null;
}

export async function readActiveWhatsAppAutopostJob(db:D1Database,userId:string,chatId:string,date:string):Promise<WhatsAppAutopostJob|null>{
  const row=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 AND status IN ('pending','claimed') LIMIT 1`)
    .bind(userId,chatId,date).first<WhatsAppAutopostRow>();
  return row?publicWhatsAppAutopostJob(row):null;
}

// The owner's Durable Object (commit 3c) is the only claimant now, and its WebSocket connection to
// the runner is the ownership proof — so an operator cancel always wins immediately, not just once a
// time-boxed lease has expired. A runner that later reports a result for a cancelled job simply finds
// its claim-time UPDATE affecting zero rows (status is no longer 'claimed') and the DO treats that as
// stale, exactly like a late waiting-check result.
export async function cancelWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,now:number){
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='cancelled',active_key=NULL,updated_at=?1,completed_at=?1
    WHERE id=?2 AND user_id=?3 AND status IN ('pending','claimed')`).bind(now,jobId,userId).run();
  if(Number(result.meta.changes||0)!==1)throw new MessengerAutomationError('Autopost уже завершено.',409);
  return {ok:true};
}

export type WhatsAppAutopostProgress = { total:number; done:number; pending:number; claimed:number; sent:number; failed:number; cancelled:number; running:boolean };

/**
 * How far today's autopost batch has got. One grouped count over a single day's jobs (at most the batch
 * limit of rows), so it is safe to read on every live-channel autopost event — the operator asked to see
 * «10 з 30», and the runner tray shows the same numbers (operator request 2026-10-06).
 */
export async function readWhatsAppAutopostProgress(db:D1Database,userId:string,date:string):Promise<WhatsAppAutopostProgress>{
  const rows=await db.prepare(`SELECT status,COUNT(*) AS count FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND published_on=?2 GROUP BY status`).bind(userId,date).all<{status:string;count:number}>();
  const counts:Record<string,number>={};
  for(const row of rows.results||[])counts[String(row.status)]=Number(row.count)||0;
  const pending=counts.pending||0;
  const claimed=counts.claimed||0;
  const sent=counts.sent||0;
  const failed=counts.failed||0;
  const cancelled=counts.cancelled||0;
  // Cancelled jobs are out of the count: pressing «Автопост черги» again re-queues the chats whose earlier
  // job failed or was stopped, so counting every row of the day showed «11 з 90» for 30 chats (operator
  // report 2026-10-07). The total is the live attempt — queued plus finished — and nothing else.
  return {total:pending+claimed+sent+failed,done:sent+failed,pending,claimed,sent,failed,cancelled,running:pending+claimed>0};
}

/**
 * Operator pressed «Скинути»: today's autopost jobs are removed outright, except the ones actually sent, so
 * the next «Автопост черги» starts from a clean queue instead of resuming where the last one stopped.
 * A sent job stays — it is the record that the chat already got its message today.
 */
export async function resetWhatsAppAutopostQueue(db:D1Database,userId:string,date:string){
  const result=await db.prepare(`DELETE FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND published_on=?2 AND status!='sent'`).bind(userId,date).run();
  return {removed:Number(result.meta.changes||0)};
}

/** Operator pressed «Зупинити»: every job of today's batch that has not been sent yet is cancelled. */
export async function cancelWhatsAppAutopostBatch(db:D1Database,userId:string,date:string,now:number){
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='cancelled',active_key=NULL,updated_at=?1,completed_at=?1
    WHERE user_id=?2 AND published_on=?3 AND status IN ('pending','claimed')`).bind(now,userId,date).run();
  return {cancelled:Number(result.meta.changes||0)};
}

export async function claimWhatsAppAutopostJob(db:D1Database,userId:string,now:number):Promise<WhatsAppAutopostTask|null>{
  for(let attempt=0;attempt<3;attempt+=1){
    const row=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
      WHERE user_id=?1 AND status='pending'
      ORDER BY created_at,id LIMIT 1`).bind(userId).first<WhatsAppAutopostRow>();
    if(!row)return null;

    const chat=await readChatState(db,userId,row.chat_id);
    const material=await db.prepare(`SELECT version,uk_text,ru_text,archived_at FROM library_items
      WHERE id=?1 AND user_id=?2 AND kind='advertisement' LIMIT 1`)
      .bind(row.advertisement_id,userId).first<{version:number;uk_text:string;ru_text:string;archived_at:number|null}>();
    const publication=await db.prepare(`SELECT id FROM chat_publications
      WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,row.chat_id,row.published_on).first<{id:string}>();
    const discovery=await db.prepare(`SELECT decision FROM chat_discovery_candidates
      WHERE user_id=?1 AND imported_chat_id=?2 AND id NOT LIKE 'waiting-%' ORDER BY updated_at DESC,id LIMIT 1`)
      .bind(userId,row.chat_id).first<{decision:string}>();
    const selection=chat ? await readPublicationAdvertisementSelection(db,{userId,chatId:row.chat_id,date:row.published_on,excludeAutomationJobId:row.id}) : null;
    const selected=selection?.items.find(item=>item.id===row.advertisement_id);
    const customMaterial=row.advertisement_id===customWhatsAppAutopostMaterialId(userId);
    const valid=Boolean(
      chat&&chat.platform==='whatsapp'&&chat.workflow_status==='ready'&&chat.state_token===row.chat_state_token
      &&!publication&&(!discovery||discovery.decision==='target')&&material
      &&(customMaterial||!material.archived_at)
      &&(customMaterial||Number(material.version)===Number(row.advertisement_version))
      &&selection?.publicationAllowed&&(customMaterial||selected?.selectable)
      &&row.payload_text.trim().length>0
    );
    if(!valid){
      await failWhatsAppAutopostJob(db,userId,row.id,'stale_precondition',now);
      continue;
    }
    const claimed=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='claimed',updated_at=?1 WHERE id=?2 AND user_id=?3 AND status='pending'`)
      .bind(now,row.id,userId).run();
    if(Number(claimed.meta.changes||0)!==1)continue;
    const image=await readWhatsAppAutopostImage(db,userId,true);
    const progress=await readWhatsAppAutopostProgress(db,userId,row.published_on);
    return {
      kind:'whatsapp_autopost',
      jobId:row.id,
      progress,
      target:{chatId:row.chat_id,expectedName:row.expected_name,expectedLink:row.expected_link},
      material:{
        advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),
        language:row.language,text:row.payload_text,
        media:image?{fileName:image.fileName,contentType:image.contentType,sizeBytes:image.sizeBytes,sha256:image.sha256,base64:image.base64}:null,
      },
      publishedOn:row.published_on,
      safety:{createsPublication:'after_confirmed_send',requiresTargetVerification:true,requiresSendConfirmation:true},
    };
  }
  return null;
}

// A runtime problem (not specific to this job) puts it back to 'pending' without a result — same
// idea as the Waiting-check release, and also what a dropped runner connection does on its own
// (see OwnerChannel.webSocketClose), so a crashed runner can't strand a job in 'claimed' forever.
export async function releaseWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,now:number){
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='pending',updated_at=?1 WHERE id=?2 AND user_id=?3 AND status='claimed'`)
    .bind(now,jobId,userId).run();
  return Number(result.meta.changes||0)===1;
}

export async function completeWhatsAppAutopostJob(db:D1Database,userId:string,input:{
  jobId:unknown;status:unknown;observedTarget:unknown;targetVerified:unknown;sendConfirmed:unknown;errorCode?:unknown;
},now:number){
  const jobId=typeof input.jobId==='string'?input.jobId.trim():'';
  if(!jobId)throw new MessengerAutomationError('WhatsApp autopost задача не вказана.');
  const row=await readWhatsAppAutopostRow(db,userId,jobId);
  if(!row||row.status!=='claimed')
    throw new MessengerAutomationError('WhatsApp autopost задача вже не в роботі.',409);

  const targetVerified=input.targetVerified===true;
  const sendConfirmed=input.sendConfirmed===true;
  const requestedSent=input.status==='sent';
  const observedTarget=typeof input.observedTarget==='string'?input.observedTarget.trim().slice(0,180):'';
  const normalizedExpected=normalizeTarget(row.expected_name);
  const normalizedObserved=normalizeTarget(observedTarget);
  const looseExpected=looseTarget(row.expected_name);
  const looseObserved=looseTarget(observedTarget);
  const exactTarget=(Boolean(normalizedExpected)&&normalizedObserved===normalizedExpected)||(
    sendConfirmed&&Boolean(looseExpected)&&looseObserved===looseExpected
  );
  if(!requestedSent||!targetVerified||!exactTarget||!sendConfirmed){
    const errorCode=cleanErrorCode(input.errorCode)||(
      !targetVerified||!exactTarget?'target_not_verified':!sendConfirmed?'send_not_confirmed':'adapter_failed'
    );
    const result={requestedStatus:requestedSent?'sent':'failed',observedTarget,targetVerified,sendConfirmed,errorCode};
    const updated=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='failed',active_key=NULL,result_json=?1,updated_at=?2,completed_at=?2
      WHERE id=?3 AND user_id=?4 AND status='claimed'`)
      .bind(JSON.stringify(result),now,jobId,userId).run();
    if(Number(updated.meta.changes||0)!==1)throw new MessengerAutomationError('WhatsApp autopost результат уже змінився.',409);
    return {ok:true,status:'failed',publicationId:null,result};
  }

  const sourceKey=`whatsapp-autopost:${row.id}`;
  const publication=await recordConfirmedWhatsappAutopostPublication(db,{
    userId,chatId:row.chat_id,advertisementId:row.advertisement_id,language:row.language,
    now,date:row.published_on,sourceKey,automationJobId:row.id,
  });
  if(!publication.ok){
    const result={requestedStatus:'sent',observedTarget,targetVerified,sendConfirmed,errorCode:'publication_reconcile_failed',publicationError:publication.error};
    const updated=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='failed',active_key=NULL,result_json=?1,updated_at=?2,completed_at=?2
      WHERE id=?3 AND user_id=?4 AND status='claimed'`)
      .bind(JSON.stringify(result),now,jobId,userId).run();
    if(Number(updated.meta.changes||0)!==1)throw new MessengerAutomationError('WhatsApp autopost accounting result уже змінився.',409);
    return {ok:false,status:'failed',publicationId:null,result};
  }

  const result={requestedStatus:'sent',observedTarget,targetVerified:true,sendConfirmed:true,errorCode:null,publicationId:publication.publicationId};
  const update=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='sent',active_key=NULL,publication_id=?1,result_json=?2,updated_at=?3,completed_at=?3
    WHERE id=?4 AND user_id=?5 AND status='claimed'`)
    .bind(publication.publicationId,JSON.stringify(result),now,jobId,userId).run();
  if(Number(update.meta.changes||0)!==1){
    const latest=await readWhatsAppAutopostRow(db,userId,jobId);
    if(latest?.status==='sent'&&latest.publication_id===publication.publicationId)
      return {ok:true,status:'sent',publicationId:publication.publicationId,result:parseObject(latest.result_json)||result};
    throw new MessengerAutomationError('Publication fact підтверджено, але autopost job потребує reconciliation.',409);
  }
  return {ok:true,status:'sent',publicationId:publication.publicationId,result};
}

export async function releaseMessengerAutomationJobsForDevice(db:D1Database,userId:string,deviceId:string,now:number){
  // WhatsApp autopost claims are no longer device-bound (the DO's WebSocket owns that, and releases
  // on disconnect on its own) — only Viber safe-mode still uses the per-device HTTP executor lease.
  await releaseViberSafeJobsForDevice(db,userId,deviceId,now);
}

async function failWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,errorCode:string,now:number){
  await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='failed',active_key=NULL,result_json=?1,updated_at=?2,completed_at=?2
    WHERE id=?3 AND user_id=?4 AND status IN ('pending','claimed')`)
    .bind(JSON.stringify({requestedStatus:'failed',targetVerified:false,sendConfirmed:false,errorCode}),now,jobId,userId).run();
}

async function readWhatsAppAutopostRow(db:D1Database,userId:string,id:string){
  return db.prepare(`SELECT * FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(id,userId).first<WhatsAppAutopostRow>();
}

function publicWhatsAppAutopostJob(row:WhatsAppAutopostRow):WhatsAppAutopostJob{
  return {
    id:row.id,requestKey:row.request_key,chatId:row.chat_id,expectedName:row.expected_name,expectedLink:row.expected_link,
    advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),language:row.language,
    publishedOn:row.published_on,status:row.status,publicationId:row.publication_id,
    createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),
    completedAt:row.completed_at===null?null:Number(row.completed_at),result:parseObject(row.result_json),
  };
}

export function normalizeTarget(value:string):string{
  return String(value||'')
    .normalize('NFC')
    .replace(/[\u200e\u200f\u202a-\u202e]/gu,'')
    .trim()
    .replace(/\s+/gu,' ')
    .toLocaleLowerCase('uk-UA');
}

export function looseTarget(value:string):string{
  return normalizeTarget(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

async function readJobRow(db:D1Database,userId:string,id:string){
  return db.prepare(`SELECT * FROM messenger_automation_jobs WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(id,userId).first<JobRow>();
}
function publicJob(row:JobRow):ViberSafeNoteJob{
  return {
    id:row.id,requestKey:row.request_key,advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),
    language:row.language,status:row.status,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),
    completedAt:row.completed_at===null?null:Number(row.completed_at),result:parseObject(row.result_json),
  };
}
function cleanRequestKey(value:unknown){
  return typeof value==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(value)?value:'';
}
function cleanErrorCode(value:unknown){
  return typeof value==='string'?value.trim().replace(/[^a-z0-9_-]/gi,'').slice(0,80):'';
}
function parseList(value:string){
  try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}
}
function parseObject(value:string|null):Record<string,unknown>|null{
  if(!value)return null;try{const parsed:unknown=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;}catch{return null;}
}
