import { cleanLibraryPlatforms } from './library.ts';

const VIBER_SAFE_LEASE_SECONDS=90;

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
