import { cleanLibraryPlatforms } from './library.ts';
import { readPublicationAdvertisementSelection } from './chats/advertisement-selection.ts';
import { publicationAvailability, recordConfirmedWhatsappAutopostPublication } from './chats/publication.ts';
import { readChatState } from './chats/state.ts';

const VIBER_SAFE_LEASE_SECONDS=90;
const WHATSAPP_AUTOPOST_LEASE_SECONDS=90;

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
  target:{chatId:string;expectedName:string;expectedLink:string};
  material:{advertisementId:string;advertisementVersion:number;language:'uk'|'ru';text:string};
  publishedOn:string;
  safety:{createsPublication:'after_confirmed_send';requiresTargetVerification:true;requiresSendConfirmation:true};
  leaseExpiresAt:number;
};

type WhatsAppAutopostRow={
  id:string;request_key:string;chat_id:string;expected_name:string;expected_link:string;chat_state_token:string;
  advertisement_id:string;advertisement_version:number;language:'uk'|'ru';payload_text:string;published_on:string;
  status:WhatsAppAutopostJob['status'];active_key:string|null;executor_device_id:string|null;lease_expires_at:number|null;
  result_json:string|null;publication_id:string|null;created_at:number;updated_at:number;completed_at:number|null;
};

export async function createWhatsAppAutopostJob(db:D1Database,userId:string,input:{
  requestKey:unknown;chatId:unknown;advertisementId?:unknown;language?:unknown;
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
    WHERE user_id=?1 AND imported_chat_id=?2 ORDER BY updated_at DESC,id LIMIT 1`)
    .bind(userId,chatId).first<{decision:string}>();
  if(discovery&&discovery.decision!=='target')throw new MessengerAutomationError('Чат із Discovery ще не підтверджений як target.',409);
  const published=await db.prepare(`SELECT id FROM chat_publications
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,chatId,date).first<{id:string}>();
  if(published)throw new MessengerAutomationError('У цьому чаті сьогодні вже є підтверджена публікація.',409);

  const selection=await readPublicationAdvertisementSelection(db,{userId,chatId,date});
  if(!selection)throw new MessengerAutomationError('Не вдалося підібрати Library material для цього чату.',409);
  if(!selection.publicationAllowed)throw new MessengerAutomationError(selection.publicationReason||'Публікація зараз заборонена правилами профілю.',409);
  const requestedId=typeof input.advertisementId==='string'?input.advertisementId.trim():'';
  const item=requestedId
    ? selection.items.find(candidate=>candidate.id===requestedId&&candidate.selectable)
    : selection.items.find(candidate=>candidate.recommended&&candidate.selectable)
      ||selection.items.find(candidate=>candidate.selectable&&candidate.directionMatch!=='other')
      ||selection.items.find(candidate=>candidate.selectable);
  if(!item)throw new MessengerAutomationError('Немає придатного невикористаного оголошення для автопублікації.',409);
  const requestedLanguage=input.language==='uk'||input.language==='ru'?input.language:null;
  const language=requestedLanguage||item.suggestedLanguage||selection.profileLanguage||(item.ukText.trim()?'uk':item.ruText.trim()?'ru':null);
  if(!language)throw new MessengerAutomationError('Для вибраного оголошення немає тексту.',409);
  const payload=(language==='uk'?item.ukText:item.ruText).trim();
  if(!payload)throw new MessengerAutomationError(`Для ${language.toUpperCase()} немає тексту оголошення.`,409);

  const library=await db.prepare(`SELECT version FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(item.id,userId).first<{version:number}>();
  if(!library)throw new MessengerAutomationError('Library material уже змінився.',409);

  const id=crypto.randomUUID();
  const activeKey=`${userId}:whatsapp:autopost:${chatId}:${date}`;
  try{
    await db.prepare(`INSERT INTO whatsapp_autopost_jobs
      (id,user_id,request_key,chat_id,expected_name,expected_link,chat_state_token,
       advertisement_id,advertisement_version,language,payload_text,published_on,status,active_key,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pending',?13,?14,?14)`)
      .bind(id,userId,requestKey,chatId,chat.name,chat.link,chat.state_token,item.id,Number(library.version),language,payload,date,activeKey,now).run();
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
  input:{limit?:unknown},
  now:number,
  date:string,
):Promise<{created:number;skipped:number;jobs:WhatsAppAutopostJob[]}>{
  const rawLimit=Number(input.limit);
  const limit=Number.isSafeInteger(rawLimit)?Math.max(1,Math.min(50,rawLimit)):30;
  const rows=await db.prepare(`SELECT c.id
    FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='ready'
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?2)
      AND NOT EXISTS(SELECT 1 FROM chat_publications p
        WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?3)
      AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j
        WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status IN ('pending','claimed'))
      AND NOT EXISTS(SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target')
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

export async function cancelWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,now:number){
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='cancelled',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,updated_at=?1,completed_at=?1
    WHERE id=?2 AND user_id=?3
      AND (status='pending' OR (status='claimed' AND lease_expires_at<=?1))`).bind(now,jobId,userId).run();
  if(Number(result.meta.changes||0)!==1)throw new MessengerAutomationError('Autopost уже виконується executor-ом; дочекайтеся результату або завершення lease.',409);
  return {ok:true};
}

export async function claimWhatsAppAutopostJob(db:D1Database,userId:string,deviceId:string,now:number):Promise<WhatsAppAutopostTask|null>{
  for(let attempt=0;attempt<3;attempt+=1){
    const row=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
      WHERE user_id=?1 AND (status='pending' OR (status='claimed' AND lease_expires_at<=?2))
      ORDER BY created_at,id LIMIT 1`).bind(userId,now).first<WhatsAppAutopostRow>();
    if(!row)return null;

    const chat=await readChatState(db,userId,row.chat_id);
    const material=await db.prepare(`SELECT version,uk_text,ru_text,archived_at FROM library_items
      WHERE id=?1 AND user_id=?2 AND kind='advertisement' LIMIT 1`)
      .bind(row.advertisement_id,userId).first<{version:number;uk_text:string;ru_text:string;archived_at:number|null}>();
    const publication=await db.prepare(`SELECT id FROM chat_publications
      WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,row.chat_id,row.published_on).first<{id:string}>();
    const discovery=await db.prepare(`SELECT decision FROM chat_discovery_candidates
      WHERE user_id=?1 AND imported_chat_id=?2 ORDER BY updated_at DESC,id LIMIT 1`)
      .bind(userId,row.chat_id).first<{decision:string}>();
    const payload=material?(row.language==='uk'?material.uk_text:material.ru_text).trim():'';
    const selection=chat ? await readPublicationAdvertisementSelection(db,{userId,chatId:row.chat_id,date:row.published_on,excludeAutomationJobId:row.id}) : null;
    const selected=selection?.items.find(item=>item.id===row.advertisement_id);
    const valid=Boolean(
      chat&&chat.platform==='whatsapp'&&chat.workflow_status==='ready'&&chat.state_token===row.chat_state_token
      &&!publication&&(!discovery||discovery.decision==='target')&&material&&!material.archived_at
      &&Number(material.version)===Number(row.advertisement_version)&&payload===row.payload_text
      &&selection?.publicationAllowed&&selected?.selectable
      &&((row.language==='uk'?selected?.ukText:selected?.ruText)||'').trim()===row.payload_text
    );
    if(!valid){
      await failWhatsAppAutopostJob(db,userId,row.id,'stale_precondition',now);
      continue;
    }
    const leaseExpiresAt=now+WHATSAPP_AUTOPOST_LEASE_SECONDS;
    const claimed=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='claimed',executor_device_id=?1,lease_expires_at=?2,updated_at=?3
      WHERE id=?4 AND user_id=?5
        AND (status='pending' OR (status='claimed' AND lease_expires_at<=?3))`)
      .bind(deviceId,leaseExpiresAt,now,row.id,userId).run();
    if(Number(claimed.meta.changes||0)!==1)continue;
    return {
      kind:'whatsapp_autopost',
      jobId:row.id,
      target:{chatId:row.chat_id,expectedName:row.expected_name,expectedLink:row.expected_link},
      material:{advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),language:row.language,text:row.payload_text},
      publishedOn:row.published_on,
      safety:{createsPublication:'after_confirmed_send',requiresTargetVerification:true,requiresSendConfirmation:true},
      leaseExpiresAt,
    };
  }
  return null;
}

export async function completeWhatsAppAutopostJob(db:D1Database,userId:string,deviceId:string,input:{
  jobId:unknown;status:unknown;observedTarget:unknown;targetVerified:unknown;sendConfirmed:unknown;errorCode?:unknown;
},now:number){
  const jobId=typeof input.jobId==='string'?input.jobId.trim():'';
  if(!jobId)throw new MessengerAutomationError('WhatsApp autopost задача не вказана.');
  const row=await readWhatsAppAutopostRow(db,userId,jobId);
  if(!row||row.status!=='claimed'||row.executor_device_id!==deviceId||!row.lease_expires_at||row.lease_expires_at<=now)
    throw new MessengerAutomationError('WhatsApp autopost lease вже не належить цьому executor.',409);

  const targetVerified=input.targetVerified===true;
  const sendConfirmed=input.sendConfirmed===true;
  const requestedSent=input.status==='sent';
  const observedTarget=typeof input.observedTarget==='string'?input.observedTarget.trim().slice(0,180):'';
  const exactTarget=normalizeTarget(observedTarget)===normalizeTarget(row.expected_name);
  if(!requestedSent||!targetVerified||!exactTarget||!sendConfirmed){
    const errorCode=cleanErrorCode(input.errorCode)||(
      !targetVerified||!exactTarget?'target_not_verified':!sendConfirmed?'send_not_confirmed':'adapter_failed'
    );
    const result={requestedStatus:requestedSent?'sent':'failed',observedTarget,targetVerified,sendConfirmed,errorCode};
    const updated=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='failed',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,
        result_json=?1,updated_at=?2,completed_at=?2
      WHERE id=?3 AND user_id=?4 AND status='claimed' AND executor_device_id=?5 AND lease_expires_at>?2`)
      .bind(JSON.stringify(result),now,jobId,userId,deviceId).run();
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
      SET status='failed',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,
        result_json=?1,updated_at=?2,completed_at=?2
      WHERE id=?3 AND user_id=?4 AND status='claimed' AND executor_device_id=?5 AND lease_expires_at>?2`)
      .bind(JSON.stringify(result),now,jobId,userId,deviceId).run();
    if(Number(updated.meta.changes||0)!==1)throw new MessengerAutomationError('WhatsApp autopost accounting result уже змінився.',409);
    return {ok:false,status:'failed',publicationId:null,result};
  }

  const result={requestedStatus:'sent',observedTarget,targetVerified:true,sendConfirmed:true,errorCode:null,publicationId:publication.publicationId};
  const update=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='sent',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,
      publication_id=?1,result_json=?2,updated_at=?3,completed_at=?3
    WHERE id=?4 AND user_id=?5 AND status='claimed' AND executor_device_id=?6 AND lease_expires_at>?3`)
    .bind(publication.publicationId,JSON.stringify(result),now,jobId,userId,deviceId).run();
  if(Number(update.meta.changes||0)!==1){
    const latest=await readWhatsAppAutopostRow(db,userId,jobId);
    if(latest?.status==='sent'&&latest.publication_id===publication.publicationId)
      return {ok:true,status:'sent',publicationId:publication.publicationId,result:parseObject(latest.result_json)||result};
    throw new MessengerAutomationError('Publication fact підтверджено, але autopost job потребує reconciliation.',409);
  }
  return {ok:true,status:'sent',publicationId:publication.publicationId,result};
}

export async function releaseWhatsAppAutopostJobsForDevice(db:D1Database,userId:string,deviceId:string,now:number){
  await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='pending',executor_device_id=NULL,lease_expires_at=NULL,updated_at=?1
    WHERE user_id=?2 AND executor_device_id=?3 AND status='claimed'`).bind(now,userId,deviceId).run();
}

export async function releaseMessengerAutomationJobsForDevice(db:D1Database,userId:string,deviceId:string,now:number){
  await Promise.all([
    releaseViberSafeJobsForDevice(db,userId,deviceId,now),
    releaseWhatsAppAutopostJobsForDevice(db,userId,deviceId,now),
  ]);
}

async function failWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,errorCode:string,now:number){
  await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='failed',active_key=NULL,executor_device_id=NULL,lease_expires_at=NULL,
      result_json=?1,updated_at=?2,completed_at=?2
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

function normalizeTarget(value:string){
  return value.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('uk-UA');
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
