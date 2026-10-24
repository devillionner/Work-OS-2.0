import { cleanLibraryPlatforms } from './library.ts';
import { rankPublicationAdvertisements, readPublicationAdvertisementSelection, type PublicationAdvertisementRow } from './chats/advertisement-selection.ts';
import { canonicalDirections } from './directions.ts';
import { publicationAvailability, recordConfirmedWhatsappAutopostPublication } from './chats/publication.ts';
import { businessDate } from './business-time.ts';
import { readChatState } from './chats/state.ts';
import { isoWeekday, profilePublicationEligibilitySql } from './chats/profile.ts';
import { settleAutopostFailure } from './messenger-automation-outcome.ts';
import { hasWhatsAppAutopostImage, readWhatsAppAutopostImage, type AutopostMaterialScope } from './whatsapp-autopost-media.ts';
import { TELEGRAM_PHOTO_CAPTION_LIMIT, TELEGRAM_TEXT_LIMIT, cleanWhatsAppAutopostCaption, readWhatsAppAutopostCaption, textLength } from './whatsapp-autopost-caption.ts';
import { applyTelegramScan, parseTelegramScan, readTelegramAutopostAccount, readTelegramThreadChoices, readTelegramThreadState, type TelegramThreadChoice, type TelegramTopic } from './telegram-autopost.ts';

const VIBER_SAFE_LEASE_SECONDS=90;
const CUSTOM_AUTOPOST_TITLE:Record<AutopostMaterialScope,string>={
  shared:'[Системний] WhatsApp автопост · власний текст',
  telegram:'[Системний] Telegram автопост · власний текст',
};
const CUSTOM_AUTOPOST_PLATFORMS:Record<AutopostMaterialScope,string>={shared:'["whatsapp"]',telegram:'["telegram"]'};

function customAutopostMaterialId(userId:string,scope:AutopostMaterialScope='shared'){
  return (scope==='telegram'?'tg_autopost_custom_':'wa_autopost_custom_')+userId;
}
/** Чи це системний матеріал із власним текстом автопосту (спільний WhatsApp/Viber або власний Telegram). */
function isCustomAutopostMaterial(userId:string,id:string){
  return id===customAutopostMaterialId(userId,'shared')||id===customAutopostMaterialId(userId,'telegram');
}

async function ensureCustomAutopostMaterial(db:D1Database,userId:string,text:string,now:number,scope:AutopostMaterialScope='shared'){
  const id=customAutopostMaterialId(userId,scope);
  const title=CUSTOM_AUTOPOST_TITLE[scope];
  const tags=scope==='telegram'?'["system","telegram-autopost"]':'["system","whatsapp-autopost"]';
  const note=scope==='telegram'?'Системний material для власного Telegram autopost caption.':'Системний material для власного WhatsApp autopost caption.';
  const platforms=CUSTOM_AUTOPOST_PLATFORMS[scope];
  const existing=await db.prepare(`SELECT version,uk_text FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(id,userId).first<{version:number;uk_text:string}>();
  if(!existing){
    await db.prepare(`INSERT INTO library_items
      (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at)
      VALUES (?1,?2,'advertisement','advertisement',1,?3,?4,'',?5,?6,?7,?8,?8,?8)`)
      .bind(id,userId,title,text,note,tags,platforms,now).run();
    return {id,version:1};
  }
  if(existing.uk_text!==text){
    await db.prepare(`UPDATE library_items
      SET uk_text=?1,ru_text='',title=?2,notes=?3,
        tags_json=?4,platforms_json=?5,archived_at=?6,
        version=version+1,updated_at=?6
      WHERE id=?7 AND user_id=?8`).bind(text,title,note,tags,platforms,now,id,userId).run();
    return {id,version:Number(existing.version)+1};
  }
  await db.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3`)
    .bind(now,id,userId).run();
  return {id,version:Number(existing.version)};
}

export class MessengerAutomationError extends Error {
  status:number;
  /** Коротка причина для підсумку партії: чому чат не потрапив у чергу. */
  code:string;
  constructor(message:string,status=400,code='rejected'){super(message);this.name='MessengerAutomationError';this.status=status;this.code=code;}
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
  if(!payload)throw new MessengerAutomationError(`Для ${language.toUpperCase()} немає тексту оголошення.`,409,'no_text');

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


/** Платформи, які автопостять через ту саму чергу задач: WhatsApp і Telegram — через браузер, Viber — через Android у Waydroid. */
export type AutopostPlatform='whatsapp'|'viber'|'telegram';
export function cleanAutopostPlatform(value:unknown):AutopostPlatform{
  return value==='viber'?'viber':value==='telegram'?'telegram':'whatsapp';
}
const AUTOPOST_PLATFORM_NAME:Record<AutopostPlatform,string>={whatsapp:'WhatsApp',viber:'Viber',telegram:'Telegram'};

export type WhatsAppAutopostJob={
  id:string;requestKey:string;chatId:string;expectedName:string;expectedLink:string;
  advertisementId:string;advertisementVersion:number;language:'uk'|'ru';publishedOn:string;
  status:'pending'|'claimed'|'sent'|'failed'|'cancelled';publicationId:string|null;
  createdAt:number;updatedAt:number;completedAt:number|null;result:Record<string,unknown>|null;
};

export type WhatsAppAutopostTask={
  /** `viber_android`: runner надсилає фото з підписом у Viber на Android у Waydroid через adb. */
  kind:'whatsapp_autopost'|'viber_android'|'telegram_autopost';
  jobId:string;
  /** Де ця задача в поточній партії, щоб трей runner показав «3/30». */
  progress?:{done:number;total:number};
  /** `verify` — лише перевірити, чи повідомлення вже є в чаті, нічого не надсилаючи (дія «Перевірити»). */
  /** `scan` — Telegram: лише подивитись, чи є в чаті гілки й які; нічого не публікується. */
  mode?:'send'|'verify'|'scan';
  /** Для `verify`: коли приблизно відправлялось (секунди Unix), щоб відрізнити сьогоднішнє повідомлення від учорашнього. */
  verify?:{sinceEpoch:number};
  target:{chatId:string;expectedName:string;expectedLink:string};
  material:{
    advertisementId:string;advertisementVersion:number;language:'uk'|'ru';text:string;
    media:{fileName:string;contentType:string;sizeBytes:number;sha256:string;base64:string}|null;
  };
  publishedOn:string;
  /** Лише для Telegram: акаунт, який має бути залогінений у браузері, і гілка форуму (null — звичайний чат або гілку ще не вибрано). */
  telegram?:{accountId:string;accountName:string;webUserId:string|null;forum:boolean|null;thread:{id:string;title:string}|null;topics:TelegramTopic[]};
  safety:{createsPublication:'after_confirmed_send';requiresTargetVerification:true;requiresSendConfirmation:true};
};

type WhatsAppAutopostRow={
  id:string;request_key:string;chat_id:string;expected_name:string;expected_link:string;chat_state_token:string;
  advertisement_id:string;advertisement_version:number;language:'uk'|'ru';payload_text:string;published_on:string;
  status:WhatsAppAutopostJob['status'];active_key:string|null;executor_device_id:string|null;lease_expires_at:number|null;
  result_json:string|null;publication_id:string|null;created_at:number;updated_at:number;completed_at:number|null;
  attempts:number;outcome:string|null;platform?:string|null;
};

/**
 * Чи можна ставити чат Telegram в автопост: вибраний акаунт увімкнений і справді його, чат не стоїть у розкладі на сьогодні, а в чаті з
 * гілками вибрано гілку. Чат, який ще жодного разу не відкривали (форум чи ні невідомо), проходить: runner дізнається це, відкривши його.
 */
async function assertTelegramJobAllowed(db:D1Database,userId:string,chatId:string,accountId:string|null){
  const row=await db.prepare(`SELECT c.telegram_account_id AS account_id,c.telegram_forum AS forum,c.telegram_thread_id AS thread,
      (SELECT a.is_enabled FROM telegram_accounts a WHERE a.id=c.telegram_account_id AND a.user_id=c.user_id) AS enabled,
      EXISTS(SELECT 1 FROM telegram_schedule_slots sl WHERE sl.user_id=c.user_id AND sl.telegram_account_id=c.telegram_account_id AND sl.chat_id=c.id AND sl.status='pending') AS in_slot
    FROM chats c WHERE c.id=?1 AND c.user_id=?2 AND c.platform='telegram' LIMIT 1`).bind(chatId,userId)
    .first<{account_id:string|null;forum:number|null;thread:string|null;enabled:number|null;in_slot:number}>();
  if(!row)throw new MessengerAutomationError('Telegram-чат не знайдено.',404,'chat_not_found');
  if(!row.account_id||Number(row.enabled)!==1)throw new MessengerAutomationError('Акаунт Telegram цього чату вимкнено або не призначено.',409,'account_disabled');
  if(accountId&&row.account_id!==accountId)throw new MessengerAutomationError('Чат належить іншому Telegram-акаунту.',409,'wrong_account');
  if(Number(row.in_slot)===1)throw new MessengerAutomationError('Чат стоїть у розкладі Telegram на сьогодні.',409,'in_schedule');
  if(row.forum===1&&!row.thread)throw new MessengerAutomationError('Для цього чату ще не вибрано гілку.',409,'thread_required');
}

export async function createWhatsAppAutopostJob(db:D1Database,userId:string,input:{
  requestKey:unknown;chatId:unknown;advertisementId?:unknown;language?:unknown;caption?:unknown;platform?:unknown;telegramAccountId?:unknown;telegramHasPhoto?:boolean;
},now:number,date:string):Promise<WhatsAppAutopostJob>{
  const requestKey=cleanRequestKey(input.requestKey);
  const chatId=typeof input.chatId==='string'?input.chatId.trim():'';
  const platform=cleanAutopostPlatform(input.platform);
  if(!requestKey||!chatId)throw new MessengerAutomationError(`Некоректний ${AUTOPOST_PLATFORM_NAME[platform]} autopost запит.`);

  const existing=await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND request_key=?2 LIMIT 1`).bind(userId,requestKey).first<WhatsAppAutopostRow>();
  if(existing)return publicWhatsAppAutopostJob(existing);

  const chat=await readChatState(db,userId,chatId);
  if(!chat||chat.platform!==platform)throw new MessengerAutomationError(`${AUTOPOST_PLATFORM_NAME[platform]}-чат не знайдено.`,404,'chat_not_found');
  const availability=publicationAvailability(chat,now);
  if(!availability.availableNow)throw new MessengerAutomationError(
    chat.workflow_status!=='ready'?'Чат зараз не в черзі публікації.':'Чат відкладено; автопублікація зараз недоступна.',409,'not_available'
  );
  const discovery=await db.prepare(`SELECT decision FROM chat_discovery_candidates
    WHERE user_id=?1 AND imported_chat_id=?2 AND id NOT LIKE 'waiting-%' ORDER BY updated_at DESC,id LIMIT 1`)
    .bind(userId,chatId).first<{decision:string}>();
  if(discovery&&discovery.decision!=='target')throw new MessengerAutomationError('Чат із Discovery ще не підтверджений як target.',409,'discovery_not_target');
  const published=await db.prepare(`SELECT id FROM chat_publications
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,chatId,date).first<{id:string}>();
  if(published)throw new MessengerAutomationError('У цьому чаті сьогодні вже є підтверджена публікація.',409,'already_published');
  if(platform==='telegram')await assertTelegramJobAllowed(db,userId,chatId,typeof input.telegramAccountId==='string'?input.telegramAccountId:null);

  // Власний текст автопоста оператор задає на вкладці автопоста WhatsApp разом із фото: він спільний для WhatsApp і Viber.
  // Без нього підпис береться з оголошення в Бібліотеці.
  // Telegram має власні фото й текст (вкладка «Автопост» Telegram), не спільні з WhatsApp і Viber; без власного тексту — оголошення з Бібліотеки.
  const scope:AutopostMaterialScope=platform==='telegram'?'telegram':'shared';
  let captionOverride='';
  if(input.caption!==undefined){
    try{captionOverride=cleanWhatsAppAutopostCaption(input.caption);}
    catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
  }else captionOverride=(await readWhatsAppAutopostCaption(db,userId,scope))?.text||'';

  // З власним текстом оголошення не вибираються, тож список матеріалів і «використане сьогодні» не читаємо (в партії це
  // давало O(n²) читань: кожна нова задача перечитувала всі вже створені).
  const selection=await readPublicationAdvertisementSelection(db,{userId,chatId,date,withItems:!captionOverride});
  if(!selection)throw new MessengerAutomationError('Не вдалося перевірити правила публікації для цього чату.',409,'rules_unavailable');
  if(!selection.publicationAllowed)throw new MessengerAutomationError(selection.publicationReason||'Публікація зараз заборонена правилами профілю.',409,'profile_rule');

  const requestedLanguage=input.language==='uk'||input.language==='ru'?input.language:null;
  let materialId='';
  let materialVersion=0;
  let language:'uk'|'ru';
  let payload='';

  if(captionOverride){
    const custom=await ensureCustomAutopostMaterial(db,userId,captionOverride,now,scope);
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
    if(!item)throw new MessengerAutomationError('Немає придатного невикористаного оголошення для автопублікації.',409,'no_advertisement');
    language=requestedLanguage||item.suggestedLanguage||selection.profileLanguage||(item.ukText.trim()?'uk':item.ruText.trim()?'ru':null as never);
    if(!language)throw new MessengerAutomationError('Для вибраного оголошення немає тексту.',409,'no_text');
    const libraryPayload=(language==='uk'?item.ukText:item.ruText).trim();
    if(!libraryPayload)throw new MessengerAutomationError(`Для ${language.toUpperCase()} немає тексту оголошення.`,409,'no_text');
    const library=await db.prepare(`SELECT version FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1`)
      .bind(item.id,userId).first<{version:number}>();
    if(!library)throw new MessengerAutomationError('Library material уже змінився.',409,'library_changed');
    materialId=item.id;
    materialVersion=Number(library.version);
    payload=libraryPayload;
  }

  // Telegram: підпис до фото не довший за 1024 символи, текст без фото за 4096. Довший не обрізаємо, а не ставимо в чергу.
  if(platform==='telegram'){
    const hasPhoto=typeof input.telegramHasPhoto==='boolean'?input.telegramHasPhoto:await hasWhatsAppAutopostImage(db,userId,'telegram');
    const length=textLength(payload);
    if(hasPhoto&&length>TELEGRAM_PHOTO_CAPTION_LIMIT)throw new MessengerAutomationError(`Текст задовгий для підпису до фото: ${length} із ${TELEGRAM_PHOTO_CAPTION_LIMIT}.`,409,'caption_too_long');
    if(length>TELEGRAM_TEXT_LIMIT)throw new MessengerAutomationError(`Текст довший за ліміт Telegram: ${length} із ${TELEGRAM_TEXT_LIMIT}.`,409,'text_too_long');
  }
  const id=crypto.randomUUID();
  const activeKey=`${userId}:${platform}:autopost:${chatId}:${date}`;
  try{
    await db.prepare(`INSERT INTO whatsapp_autopost_jobs
      (id,user_id,request_key,chat_id,expected_name,expected_link,chat_state_token,
       advertisement_id,advertisement_version,language,payload_text,published_on,status,active_key,created_at,updated_at,platform)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pending',?13,?14,?14,?15)`)
      .bind(id,userId,requestKey,chatId,chat.name,chat.link,chat.state_token,materialId,materialVersion,language,payload,date,activeKey,now,platform).run();
  }catch(error){
    const active=await readActiveWhatsAppAutopostJob(db,userId,chatId,date);
    if(active)throw new MessengerAutomationError(`Для цього чату вже є активна ${AUTOPOST_PLATFORM_NAME[platform]} автопублікація.`,409,'already_queued');
    throw error;
  }
  const created=await readWhatsAppAutopostRow(db,userId,id);
  if(!created)throw new MessengerAutomationError(`Не вдалося створити ${AUTOPOST_PLATFORM_NAME[platform]} autopost задачу.`,409);
  return publicWhatsAppAutopostJob(created);
}

/** Задача проходу «знайти гілки»: ключ `scan_<id партії або none>_<uuid>`. Така задача нічого не публікує й не займає вікно інтервалу. */
const SCAN_KEY=/^scan_([0-9a-f-]{36}|none)_/;
const isScanKey=(key:string)=>key.startsWith('scan_');

/**
 * Telegram: окрема задача, яка лише відкриває чат і дивиться, чи є в ньому гілки (і збирає їх). Чат без гілок одразу стає в чергу
 * публікації тієї ж партії, чат із гілками потрапляє в групу «Вибрати гілку». Вікон «N на годину» вона не займає й спробами не рахується.
 */
export async function createTelegramScanJob(db:D1Database,userId:string,chatId:string,accountId:string,now:number,date:string,batchId:string|null):Promise<WhatsAppAutopostJob>{
  const chat=await readChatState(db,userId,chatId);
  if(!chat||chat.platform!=='telegram')throw new MessengerAutomationError('Telegram-чат не знайдено.',404,'chat_not_found');
  if(chat.workflow_status!=='ready')throw new MessengerAutomationError('Чат зараз не в черзі публікації.',409,'not_available');
  if(chat.telegram_account_id!==accountId)throw new MessengerAutomationError('Чат належить іншому Telegram-акаунту.',409,'wrong_account');
  // Зовнішній ключ задачі вимагає існуючого матеріалу; текст у проході не використовується.
  const material=await db.prepare(`SELECT id,version FROM library_items WHERE user_id=?1 AND kind='advertisement' ORDER BY archived_at IS NOT NULL,updated_at DESC LIMIT 1`).bind(userId).first<{id:string;version:number}>();
  if(!material)throw new MessengerAutomationError('У Бібліотеці немає жодного оголошення.',409,'no_advertisement');
  const id=crypto.randomUUID();
  const activeKey=`${userId}:telegram:autopost:${chatId}:${date}`;
  try{
    await db.prepare(`INSERT INTO whatsapp_autopost_jobs
      (id,user_id,request_key,chat_id,expected_name,expected_link,chat_state_token,
       advertisement_id,advertisement_version,language,payload_text,published_on,status,active_key,created_at,updated_at,platform)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'uk','',?10,'pending',?11,?12,?12,'telegram')`)
      .bind(id,userId,`scan_${batchId||'none'}_${crypto.randomUUID()}`,chatId,chat.name,chat.link,chat.state_token,material.id,Number(material.version),date,activeKey,now).run();
  }catch(error){
    if(await readActiveWhatsAppAutopostJob(db,userId,chatId,date))throw new MessengerAutomationError('Для цього чату вже є активна задача.',409,'already_queued');
    throw error;
  }
  const created=await readWhatsAppAutopostRow(db,userId,id);
  if(!created)throw new MessengerAutomationError('Не вдалося створити задачу пошуку гілок.',409);
  return publicWhatsAppAutopostJob(created);
}

/**
 * Кнопка «Знайти гілки»: прохід по чатах вибраного акаунта, про які ще невідомо, чи є в них гілки, і по чатах, що чекають вибору гілки
 * (оновити список). Без партії: чат без гілок просто стає «відомим».
 */
export async function createTelegramScanBatch(db:D1Database,userId:string,accountId:string,now:number,date:string):Promise<{created:number;skipped:number}>{
  const rows=await db.prepare(`SELECT c.id AS id FROM chats c
    WHERE c.user_id=?1 AND c.platform='telegram' AND c.telegram_account_id=?2 AND c.workflow_status='ready'
      AND (c.telegram_forum IS NULL OR (c.telegram_forum=1 AND c.telegram_thread_id IS NULL))
      AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status IN ('pending','claimed'))
    ORDER BY c.telegram_forum IS NOT NULL,c.name LIMIT ?4`).bind(userId,accountId,date,AUTOPOST_BATCH_MAX).all<{id:string}>();
  let created=0;let skipped=0;
  for(const row of rows.results||[]){
    try{await createTelegramScanJob(db,userId,row.id,accountId,now,date,null);created+=1;}
    catch(error){if(error instanceof MessengerAutomationError&&[404,409].includes(error.status)){skipped+=1;continue;}throw error;}
  }
  return {created,skipped};
}

/**
 * Дія «Перевірити» зі списку «Потребують рішення»: нова задача того ж чату з тим самим текстом, яка нічого не надсилає, а лише
 * відкриває чат і шукає в ньому повідомлення. Знайшла — публікація записується як після звичайної відправки.
 */
export async function createAutopostVerifyJob(db:D1Database,userId:string,originalJobId:string,now:number,date:string):Promise<WhatsAppAutopostJob>{
  const original=await readWhatsAppAutopostRow(db,userId,originalJobId);
  if(!original||original.published_on!==date)throw new MessengerAutomationError('Перевірити можна лише чат із сьогоднішньої партії.',409,'not_today');
  const chat=await readChatState(db,userId,original.chat_id);
  const platform=chat?cleanAutopostPlatform(chat.platform):null;
  if(!chat||!platform)throw new MessengerAutomationError('Чат не знайдено.',404,'chat_not_found');
  const id=crypto.randomUUID();
  const activeKey=`${userId}:${platform}:autopost:${original.chat_id}:${date}`;
  // Момент справжньої відправки (першої невизначеної спроби) береться з колонки lease_expires_at, яку для автопосту інакше не використовують,
  // і переходить по ланцюжку повторних перевірок; для давніх перевірок без неї 0 означає «час невідомий».
  const sinceEpoch=original.lease_expires_at!==null&&original.lease_expires_at>0?Number(original.lease_expires_at):original.request_key.startsWith('verify_')?0:Number(original.completed_at??original.updated_at);
  try{
    await db.prepare(`INSERT INTO whatsapp_autopost_jobs
      (id,user_id,request_key,chat_id,expected_name,expected_link,chat_state_token,
       advertisement_id,advertisement_version,language,payload_text,published_on,status,active_key,result_json,lease_expires_at,created_at,updated_at,platform)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pending',?13,?14,?15,?16,?16,?17)`)
      .bind(id,userId,`verify_${id}`,original.chat_id,chat.name,chat.link,chat.state_token,original.advertisement_id,original.advertisement_version,
        original.language,original.payload_text,date,activeKey,JSON.stringify({verifyOf:originalJobId,sinceEpoch}),sinceEpoch||null,now,platform).run();
  }catch(error){
    if(await readActiveWhatsAppAutopostJob(db,userId,original.chat_id,date))throw new MessengerAutomationError('Для цього чату вже є активна задача.',409,'already_queued');
    throw error;
  }
  const created=await readWhatsAppAutopostRow(db,userId,id);
  if(!created)throw new MessengerAutomationError('Не вдалося створити задачу перевірки.',409);
  return publicWhatsAppAutopostJob(created);
}

/**
 * Що буде, якщо натиснути «Опублікувати» просто зараз: скільки чатів платформи справді піде в партію (за тими самими правилами,
 * що й `createWhatsAppAutopostBatch`) і чому решта «Для публікації» не йде. Один запит по чатах платформи; рахується при відкритті
 * вкладки й після дій, а не за таймером.
 */
export type AutopostBucket='ready'|'decision'|'tried'|'published'|'rules'|'snoozed'|'queued'|'other'|'thread'|'schedule'|'toolong';
export type AutopostPlan={
  total:number;ready:number;publishedToday:number;queued:number;decision:number;tried:number;snoozed:number;
  rules:number;rulesNextDate:string|null;other:number;
  /** Чати, що підуть у партію, у порядку відправки (до 100). */
  chats:Array<{id:string;name:string}>;
  /** Кожен чат черги «Для публікації» рівно в одній групі: за цим розкладом групується список зліва й лічаться чіпи, «Огляд» і картка. */
  buckets:Record<string,AutopostBucket>;
  /** Для «потребують рішення» й «пробували»: код причини й назва, яку бачив месенджер; для «правил» — найближча дата. */
  reasons:Record<string,{code:string|null;observed:string|null;next:string|null}>;
  /** Лише Telegram: скільки чатів чекають вибору гілки й у розкладі, і самі чати з гілками, з яких власник вибирає. */
  thread?:number;schedule?:number;threadChoices?:TelegramThreadChoice[];
  /** Лише Telegram: чати, чий текст із Бібліотеки задовгий для підпису до фото (з фото вони в партію не йдуть). */
  tooLong?:number;tooLongChats?:Array<{id:string;name:string;length:number}>;
  /** Telegram: готові чати, про які ще невідомо, чи є в них гілки (їх перевірить прохід перед партією). */
  unscanned?:number;
};
export async function readAutopostPlan(db:D1Database,userId:string,platformInput:unknown,now:number,date:string,telegramAccountId:string|null=null):Promise<AutopostPlan>{
  const platform=cleanAutopostPlatform(platformInput);
  const telegram=platform==='telegram';
  if(telegram&&!telegramAccountId)throw new MessengerAutomationError('Вибери активний Telegram-акаунт.',409,'account_missing');
  // Telegram: чат із гілками без вибраної гілки й чат у розкладі на сьогодні в партію не йдуть; 6 годин після вступу — як «відкладено».
  const telegramWhen=telegram?`
        WHEN c.telegram_forum=1 AND c.telegram_thread_id IS NULL THEN 'thread'
        WHEN EXISTS(SELECT 1 FROM telegram_schedule_slots sl WHERE sl.user_id=c.user_id AND sl.telegram_account_id=c.telegram_account_id AND sl.chat_id=c.id AND sl.status='pending') THEN 'schedule'
        WHEN c.joined_at IS NOT NULL AND c.joined_at+21600>?2 THEN 'snoozed'`:'';
  const rows=await db.prepare(`SELECT c.id AS id,c.name AS name,c.telegram_forum AS forum,
      CASE
        WHEN EXISTS(SELECT 1 FROM chat_publications p WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?3) THEN 'published'
        WHEN EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status IN ('pending','claimed')) THEN 'queued'${telegramWhen}
        WHEN EXISTS(SELECT 1 FROM whatsapp_autopost_jobs d WHERE d.user_id=c.user_id AND d.chat_id=c.id AND d.published_on=?3 AND d.outcome='needs_decision') THEN 'decision'
        WHEN EXISTS(SELECT 1 FROM whatsapp_autopost_jobs t WHERE t.user_id=c.user_id AND t.chat_id=c.id AND t.published_on=?3 AND t.status IN ('sent','failed')) THEN 'tried'
        WHEN c.snoozed_until IS NOT NULL AND c.snoozed_until>?2 THEN 'snoozed'
        WHEN EXISTS(SELECT 1 FROM chat_discovery_candidates dc WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target' AND dc.id NOT LIKE 'waiting-%') THEN 'other'
        WHEN NOT (${profilePublicationEligibilitySql('?3','?5')}
          OR NOT EXISTS(SELECT 1 FROM chat_profiles pu WHERE pu.chat_id=c.id AND pu.review_status='confirmed')) THEN 'rules'
        ELSE 'ready'
      END AS bucket,
      (SELECT pr.next_allowed_on FROM chat_profiles pr WHERE pr.chat_id=c.id) AS next_allowed_on,
      (SELECT json_extract(j.result_json,'$.errorCode') FROM whatsapp_autopost_jobs j WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status='failed' ORDER BY j.updated_at DESC LIMIT 1) AS code,
      (SELECT json_extract(j.result_json,'$.observedTarget') FROM whatsapp_autopost_jobs j WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status='failed' ORDER BY j.updated_at DESC LIMIT 1) AS observed,
      COALESCE((SELECT MAX(p2.published_on) FROM chat_publications p2 WHERE p2.user_id=c.user_id AND p2.chat_id=c.id),'') AS last_published
    FROM chats c WHERE c.user_id=?1 AND c.platform=?4 AND c.workflow_status='ready'${telegram?' AND c.telegram_account_id=?6':''}`)
    .bind(userId,now,date,platform,isoWeekday(date),...(telegram?[telegramAccountId]:[])).all<{id:string;name:string;forum:number|null;bucket:string;next_allowed_on:string|null;code:string|null;observed:string|null;last_published:string}>();
  const plan:AutopostPlan={total:0,ready:0,publishedToday:0,queued:0,decision:0,tried:0,snoozed:0,rules:0,rulesNextDate:null,other:0,chats:[],buckets:{},reasons:{}};
  const ready:Array<{id:string;name:string;last:string}>=[];
  for(const row of rows.results){
    plan.total+=1;
    plan.buckets[row.id]=(['ready','decision','tried','published','rules','snoozed','queued','thread','schedule','toolong'].includes(row.bucket)?row.bucket:'other') as AutopostBucket;
    if(row.bucket==='decision'||row.bucket==='tried')plan.reasons[row.id]={code:row.code,observed:row.observed,next:null};
    else if(row.bucket==='rules')plan.reasons[row.id]={code:null,observed:null,next:row.next_allowed_on&&row.next_allowed_on>date?row.next_allowed_on:null};
    switch(row.bucket){
      case 'published':plan.publishedToday+=1;break;
      case 'queued':plan.queued+=1;break;
      case 'decision':plan.decision+=1;break;
      case 'tried':plan.tried+=1;break;
      case 'snoozed':plan.snoozed+=1;break;
      case 'thread':plan.thread=(plan.thread||0)+1;break;
      case 'schedule':plan.schedule=(plan.schedule||0)+1;break;
      case 'rules':
        plan.rules+=1;
        if(row.next_allowed_on&&row.next_allowed_on>date&&(!plan.rulesNextDate||row.next_allowed_on<plan.rulesNextDate))plan.rulesNextDate=row.next_allowed_on;
        break;
      case 'ready':ready.push({id:row.id,name:row.name,last:row.last_published});if(telegram&&row.forum===null)plan.unscanned=(plan.unscanned||0)+1;break;
      default:plan.other+=1;
    }
  }
  // Telegram із фото: текст Бібліотеки довший за 1024 символи не влізе в підпис, такі чати до запуску виходять із «Готових».
  if(telegram&&ready.length&&await hasWhatsAppAutopostImage(db,userId,'telegram')&&!(await readWhatsAppAutopostCaption(db,userId,'telegram'))?.text){
    const [ads,profiles]=await Promise.all([
      db.prepare(`SELECT id,title,uk_text,ru_text,notes,tags_json,platforms_json,updated_at FROM library_items
        WHERE user_id=?1 AND kind='advertisement' AND archived_at IS NULL ORDER BY updated_at DESC,title LIMIT 500`).bind(userId).all<PublicationAdvertisementRow>(),
      db.prepare(`SELECT c.id AS id,p.language AS language,p.directions_json AS directions_json,p.review_status AS review_status
        FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id
        WHERE c.user_id=?1 AND c.platform='telegram' AND c.telegram_account_id=?2 AND c.workflow_status='ready'`).bind(userId,telegramAccountId).all<{id:string;language:string|null;directions_json:string|null;review_status:string|null}>(),
    ]);
    const profileById=new Map(profiles.results.map(row=>[row.id,row]));
    const tooLong:Array<{id:string;name:string;length:number}>=[];
    for(const chat of ready.slice()){
      const profile=profileById.get(chat.id);
      const profileLanguage=profile?.language==='uk'||profile?.language==='ru'?profile.language:null;
      const items=rankPublicationAdvertisements(ads.results,{
        platform:'telegram',profileLanguage,profileDirections:canonicalDirections(parseList(profile?.directions_json||'[]')),
        profileConfirmed:profile?.review_status==='confirmed',usedToday:new Set(),
      });
      const item=items.find(candidate=>candidate.recommended&&candidate.selectable)||items.find(candidate=>candidate.selectable&&candidate.directionMatch!=='other')||items.find(candidate=>candidate.selectable);
      const language=item?(profileLanguage&&(profileLanguage==='uk'?item.ukText:item.ruText).trim()?profileLanguage:item.suggestedLanguage):null;
      const text=item&&language?(language==='uk'?item.ukText:item.ruText).trim():'';
      const length=textLength(text);
      if(length>TELEGRAM_PHOTO_CAPTION_LIMIT){
        tooLong.push({id:chat.id,name:chat.name,length});
        plan.buckets[chat.id]='toolong';
        ready.splice(ready.findIndex(entry=>entry.id===chat.id),1);
      }
    }
    plan.tooLong=tooLong.length;
    plan.tooLongChats=tooLong.slice(0,100);
  }
  ready.sort((a,b)=>a.last<b.last?-1:a.last>b.last?1:a.id<b.id?-1:a.id>b.id?1:0);
  plan.ready=ready.length;
  plan.chats=ready.slice(0,AUTOPOST_BATCH_MAX).map(({id,name})=>({id,name}));
  if(telegram)plan.threadChoices=await readTelegramThreadChoices(db,userId,telegramAccountId);
  return plan;
}

export type AutopostBatchResult={
  created:number;
  /** Скільки з них — проходи «знайти гілки» (Telegram): чат без гілок стане в чергу публікації після проходу. */
  scanning?:number;
  /** Чати, які пройшли відбір, але не стали задачею (див. reasons). */
  skipped:number;
  /** Чому саме чати не потрапили в партію: код причини й кількість. */
  reasons:Array<{code:string;count:number}>;
  /** Партію обмежено розміром, а придатні чати ще лишились: запуск повторюється. */
  more:boolean;
  jobs:WhatsAppAutopostJob[];
  batchId:string;
};

const AUTOPOST_BATCH_DEFAULT=100;
const AUTOPOST_BATCH_MAX=200;
const AUTOPOST_BATCH_PAGE=40;
const AUTOPOST_BATCH_SCAN_MAX=400;

/**
 * Партія автопосту на сьогодні: кожен придатний чат «Для публікації» стає задачею рівно один раз за день.
 * Відбір той самий, що дає список «Для публікації» (готовий, не відкладений, без публікації сьогодні, дозволений
 * правилами профілю), а не «перші N за оновленням»: раніше чати, яким профіль забороняв публікацію, забивали пул,
 * і партія виходила неповною. Чат, у якого сьогодні вже є задача (в роботі, невдала чи відправлена) або чекає
 * рішення власника, у партію не повертається. Порядок справедливий: спершу чати без публікацій, далі ті, де вона
 * була найдавніше, тож повторюється не той самий верх списку.
 */
export async function createWhatsAppAutopostBatch(
  db:D1Database,
  userId:string,
  input:{limit?:unknown;caption?:unknown;platform?:unknown;exclude?:unknown;telegramAccountId?:unknown},
  now:number,
  date:string,
):Promise<AutopostBatchResult>{
  const platform=cleanAutopostPlatform(input.platform);
  const telegramAccountId=platform==='telegram'&&typeof input.telegramAccountId==='string'?input.telegramAccountId:null;
  if(platform==='telegram'&&!telegramAccountId)throw new MessengerAutomationError('Вибери активний Telegram-акаунт.',409,'account_missing');
  // Фото для обох платформ одне, його додають на вкладці автопоста WhatsApp: без нього Viber нічого не відправить.
  if(platform==='viber'&&!await readWhatsAppAutopostImage(db,userId))
    throw new MessengerAutomationError('Для автопосту Viber спершу додай фото на вкладці «Автопост» у WhatsApp.',409,'image_missing');
  const rawLimit=Number(input.limit);
  const limit=Number.isSafeInteger(rawLimit)?Math.max(1,Math.min(AUTOPOST_BATCH_MAX,rawLimit)):AUTOPOST_BATCH_DEFAULT;
  let caption='';
  // Telegram: власні фото й текст (окремі від WhatsApp і Viber); без тексту — оголошення з Бібліотеки для кожного чату.
  const materialScope:AutopostMaterialScope=platform==='telegram'?'telegram':'shared';
  const telegramHasPhoto=platform==='telegram'?await hasWhatsAppAutopostImage(db,userId,'telegram'):false;
  if(input.caption!==undefined){
    try{caption=cleanWhatsAppAutopostCaption(input.caption);}
    catch(error){throw new MessengerAutomationError(error instanceof Error?error.message:'Некоректний текст автопоста.');}
  }else caption=(await readWhatsAppAutopostCaption(db,userId,materialScope))?.text||'';
  // Чати, які оператор прибрав зі списку партії «лише на цей запуск».
  const excluded=JSON.stringify(Array.isArray(input.exclude)?input.exclude.filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=100).slice(0,200):[]);
  const weekday=isoWeekday(date);
  // Telegram: лише чати вибраного акаунта; чат із гілками без вибраної гілки, чат у розкладі на сьогодні й чат, що ще не відлежав 6 годин
  // після вступу, у партію не йдуть (перші два стають окремими групами в картці).
  const telegramFilter=platform==='telegram'?`
      AND c.telegram_account_id=?9
      AND (c.telegram_forum IS NOT 1 OR c.telegram_thread_id IS NOT NULL)
      AND (c.joined_at IS NULL OR c.joined_at+21600<=?2)
      AND NOT EXISTS(SELECT 1 FROM telegram_schedule_slots sl WHERE sl.user_id=c.user_id AND sl.telegram_account_id=c.telegram_account_id AND sl.chat_id=c.id AND sl.status='pending')`:'';
  const candidates=(size:number,offset:number)=>db.prepare(`SELECT c.id,c.telegram_forum AS forum
    FROM chats c
    WHERE c.user_id=?1 AND c.platform=?5 AND c.workflow_status='ready'
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?2)
      AND NOT EXISTS(SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target' AND dc.id NOT LIKE 'waiting-%')
      AND NOT EXISTS(SELECT 1 FROM chat_publications p
        WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?3)
      AND (${profilePublicationEligibilitySql('?3','?6')}
        OR NOT EXISTS(SELECT 1 FROM chat_profiles pu WHERE pu.chat_id=c.id AND pu.review_status='confirmed'))
      AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j
        WHERE j.user_id=c.user_id AND j.chat_id=c.id AND j.published_on=?3 AND j.status IN ('pending','claimed','sent','failed'))
      AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs d
        WHERE d.user_id=c.user_id AND d.chat_id=c.id AND d.published_on=?3 AND d.outcome='needs_decision')
      AND c.id NOT IN (SELECT value FROM json_each(?8))${telegramFilter}
    ORDER BY COALESCE((SELECT MAX(p2.published_on) FROM chat_publications p2 WHERE p2.user_id=c.user_id AND p2.chat_id=c.id),''),c.id
    LIMIT ?4 OFFSET ?7`).bind(userId,now,date,size,platform,weekday,offset,excluded,...(telegramAccountId?[telegramAccountId]:[])).all<{id:string;forum:number|null}>();

  const batchId=crypto.randomUUID();
  const jobs:WhatsAppAutopostJob[]=[];
  let scanning=0;
  const reasons=new Map<string,number>();
  let skipped=0;
  let scanned=0;
  while(jobs.length<limit&&scanned<AUTOPOST_BATCH_SCAN_MAX){
    // Створені задачі виходять із вибірки, пропущені лишаються: зсув дорівнює кількості пропущених.
    const page=await candidates(AUTOPOST_BATCH_PAGE,skipped);
    if(!page.results.length)break;
    for(const row of page.results){
      if(jobs.length>=limit)break;
      scanned+=1;
      try{
        // Telegram: чат, про який ще невідомо, чи є в ньому гілки, спершу проходить швидкий прохід (він не займає вікон інтервалу),
        // а чат без гілок уже тоді стає в чергу цієї партії. Так форум без гілки не витрачає місце в черзі «N на годину».
        if(platform==='telegram'&&telegramAccountId&&row.forum===null){
          jobs.push(await createTelegramScanJob(db,userId,row.id,telegramAccountId,now,date,batchId));
          scanning+=1;
          continue;
        }
        jobs.push(await createWhatsAppAutopostJob(db,userId,{
          requestKey:`${batchKeyPrefix(platform,batchId)}${crypto.randomUUID()}`,
          chatId:row.id,
          caption,
          platform,
          telegramAccountId,
          telegramHasPhoto,
        },now,date));
      }catch(error){
        if(error instanceof MessengerAutomationError&&[404,409].includes(error.status)){
          skipped+=1;
          reasons.set(error.code,(reasons.get(error.code)||0)+1);
          continue;
        }
        throw error;
      }
    }
  }
  const more=jobs.length>=limit&&(await candidates(1,skipped)).results.length>0;
  return {created:jobs.length,scanning,skipped,reasons:[...reasons].map(([code,count])=>({code,count})),more,jobs,batchId};
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
    WHERE id=?2 AND user_id=?3 AND status IN ('pending','claimed') RETURNING id`).bind(now,jobId,userId).all<{id:string}>();
  if(result.results.length!==1)throw new MessengerAutomationError('Autopost уже завершено.',409);
  return {ok:true};
}

export type WhatsAppAutopostSettled = { archived:number; waiting:number; snoozed:number; skipped:number; decision:number; /** Telegram: чати з гілками, що чекають вибору гілки (не збій). */ thread:number };
export type AutopostBatchEntry = { jobId:string; name:string; status:'claimed'|'sent'|'failed'; outcome:string|null; code:string|null; at:number };
/** Поточна партія платформи (остання за сьогодні): лічильники лише її задач, без скасованих задач старих партій. */
export type AutopostBatch = { id:string; startedAt:number; total:number; sent:number; remaining:number; failed:number; skipped:number; cancelled:number; /** Чати партії, що чекають вибору гілки: не «Не вдалося». */ thread:number; averageSeconds:number|null; entries:AutopostBatchEntry[] };
export type WhatsAppAutopostProgress = { total:number; done:number; pending:number; claimed:number; sent:number; failed:number; cancelled:number; running:boolean; settled:WhatsAppAutopostSettled; batch:AutopostBatch|null };

const BATCH_KEY=/^batch_(whatsapp|viber|telegram)_([0-9a-f-]{36})_/;
/** Ключ задачі партії: платформа й id партії всередині ключа дають змогу читати партію діапазоном по унікальному індексу, без нової міграції. */
const batchKeyPrefix=(platform:AutopostPlatform,batchId:string)=>`batch_${platform}_${batchId}_`;

export async function readAutopostBatch(db:D1Database,userId:string,platform:AutopostPlatform,date:string,knownBatchId?:string):Promise<AutopostBatch|null>{
  let batchId=knownBatchId||'';
  if(!batchId){
    // Індекс (user_id, created_at DESC) віддає найновіші задачі першими, тож пошук зупиняється на першому збігу.
    const latest=await db.prepare(`SELECT request_key,published_on FROM whatsapp_autopost_jobs WHERE user_id=?1 AND request_key LIKE ?2 ESCAPE '\\'
      ORDER BY created_at DESC,id DESC LIMIT 1`).bind(userId,`batch\\_${platform}\\_%`).first<{request_key:string;published_on:string}>();
    const match=latest?.request_key.match(BATCH_KEY);
    if(!latest||!match||latest.published_on!==date)return null;
    batchId=match[2];
  }
  const prefix=batchKeyPrefix(platform,batchId);
  const rows=await db.prepare(`SELECT id,expected_name,status,outcome,json_extract(result_json,'$.errorCode') AS code,created_at,updated_at,completed_at
    FROM whatsapp_autopost_jobs WHERE user_id=?1 AND request_key>=?2 AND request_key<?3`)
    .bind(userId,prefix,`${prefix.slice(0,-1)}\``).all<{id:string;expected_name:string;status:string;outcome:string|null;code:string|null;created_at:number;updated_at:number;completed_at:number|null}>();
  if(!rows.results.length)return null;
  const batch:AutopostBatch={id:batchId,startedAt:Number.MAX_SAFE_INTEGER,total:0,sent:0,remaining:0,failed:0,skipped:0,cancelled:0,thread:0,averageSeconds:null,entries:[]};
  let lastFinished=0;
  let finished=0;
  for(const row of rows.results){
    batch.startedAt=Math.min(batch.startedAt,Number(row.created_at));
    if(row.status==='cancelled'){batch.cancelled+=1;continue;}
    if(row.outcome==='needs_thread'){batch.thread+=1;continue;}
    batch.total+=1;
    const at=Number(row.completed_at??row.updated_at);
    if(row.status==='pending'){batch.remaining+=1;continue;}
    if(row.status==='claimed'){batch.remaining+=1;batch.entries.push({jobId:row.id,name:row.expected_name,status:'claimed',outcome:null,code:null,at});continue;}
    finished+=1;lastFinished=Math.max(lastFinished,at);
    if(row.status==='sent')batch.sent+=1;
    else if(!row.outcome||row.outcome==='needs_decision')batch.failed+=1;
    else batch.skipped+=1;
    batch.entries.push({jobId:row.id,name:row.expected_name,status:row.status as 'sent'|'failed',outcome:row.outcome,code:row.code,at});
  }
  if(finished>0)batch.averageSeconds=Math.max(1,Math.round((lastFinished-batch.startedAt)/finished));
  batch.entries.sort((a,b)=>b.at-a.at);
  batch.entries=batch.entries.slice(0,60);
  return batch;
}

/**
 * How far today's autopost batch has got. A dozen day counters (autopost_day_counts) whatever the batch size,
 * so it is safe to read on every live-channel autopost event — the operator asked to see
 * «10 з 30», and the runner tray shows the same numbers (operator request 2026-10-06).
 */
export async function readWhatsAppAutopostProgress(db:D1Database,userId:string,date:string,platform:AutopostPlatform='whatsapp'):Promise<WhatsAppAutopostProgress>{
  // Лічильники дня ведуть тригери на whatsapp_autopost_jobs (міграція 0050): кілька рядків замість підрахунку всіх задач дня.
  // Закриті рішенням власника («resolved») не рахуються: чат або заархівовано, або він має нову задачу.
  const rows=await db.prepare(`SELECT status,outcome,SUM(job_count) AS count FROM autopost_day_counts
    WHERE user_id=?1 AND published_on=?2 AND platform=?3 AND outcome!='resolved'
    GROUP BY status,outcome HAVING SUM(job_count)>0`).bind(userId,date,platform).all<{status:string;outcome:string|null;count:number}>();
  const counts:Record<string,number>={};
  const settled:WhatsAppAutopostSettled={archived:0,waiting:0,snoozed:0,skipped:0,decision:0,thread:0};
  for(const row of rows.results||[]){
    const count=Number(row.count)||0;
    counts[String(row.status)]=(counts[String(row.status)]||0)+count;
    if(row.status==='failed'){
      if(row.outcome==='archived')settled.archived+=count;
      else if(row.outcome==='waiting')settled.waiting+=count;
      else if(row.outcome==='snoozed')settled.snoozed+=count;
      else if(row.outcome==='needs_decision')settled.decision+=count;
      else if(row.outcome==='needs_thread')settled.thread+=count;
      else settled.skipped+=count;
    }
  }
  const pending=counts.pending||0;
  const claimed=counts.claimed||0;
  const sent=counts.sent||0;
  // Чат, що чекає вибору гілки, не провалився: у «Не вдалося» й у загальну кількість партії не входить.
  const failed=Math.max(0,(counts.failed||0)-settled.thread);
  const cancelled=counts.cancelled||0;
  // Cancelled jobs are out of the count: pressing «Автопост черги» again re-queues the chats whose earlier
  // job failed or was stopped, so counting every row of the day showed «11 з 90» for 30 chats (operator
  // report 2026-10-07). The total is the live attempt — queued plus finished — and nothing else.
  const batch=await readAutopostBatch(db,userId,platform,date);
  return {total:pending+claimed+sent+failed,done:sent+failed,pending,claimed,sent,failed,cancelled,running:pending+claimed>0,settled,batch};
}

/**
 * Operator pressed «Скинути»: today's autopost jobs are removed outright, except the ones actually sent, so
 * the next «Автопост черги» starts from a clean queue instead of resuming where the last one stopped.
 * A sent job stays — it is the record that the chat already got its message today.
 */
export async function resetWhatsAppAutopostQueue(db:D1Database,userId:string,date:string,platform:AutopostPlatform='whatsapp'){
  const result=await db.prepare(`DELETE FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND published_on=?2 AND status!='sent'
      AND chat_id IN (SELECT id FROM chats WHERE user_id=?1 AND platform=?3) RETURNING id`).bind(userId,date,platform).all<{id:string}>();
  return {removed:result.results.length};
}

/** Operator pressed «Зупинити»: every job of today's batch that has not been sent yet is cancelled. */
export async function cancelWhatsAppAutopostBatch(db:D1Database,userId:string,date:string,now:number,platform:AutopostPlatform='whatsapp'){
  // Вибірка задач у роботі йде через частковий індекс (лише pending/claimed), платформа перевіряється вже по цих рядках.
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='cancelled',active_key=NULL,updated_at=?1,completed_at=?1
    WHERE id IN (SELECT j.id FROM whatsapp_autopost_jobs j JOIN chats c ON c.id=j.chat_id AND c.user_id=j.user_id
      WHERE j.user_id=?2 AND j.status IN ('pending','claimed') AND j.published_on=?3 AND c.platform=?4) RETURNING id`).bind(now,userId,date,platform).all<{id:string}>();
  return {cancelled:result.results.length};
}

/** Доба, за яку вже закрито задачі минулих днів (на isolate): повторювати це на кожен claim нема потреби. */
const closedPastDays=new Map<string,string>();

export async function claimWhatsAppAutopostJob(db:D1Database,userId:string,now:number,onSkip?:(row:WhatsAppAutopostRow,reason:string)=>void,options:{excludePlatforms?:AutopostPlatform[];/** Telegram чекає свого інтервалу: публікації не видаються, а проходи «знайти гілки» так. */skipTelegramSends?:boolean}={}):Promise<WhatsAppAutopostTask|null>{
  // Платформи, чия черга зараз на паузі чи чекає свого інтервалу (Telegram), пропускаються: інші платформи не стоять за ними.
  const excluded=(options.excludePlatforms||[]).map(cleanAutopostPlatform);
  const today=businessDate(now);
  // Задачі за минулі дні не виконуються: публікація записалась би вчорашньою датою. Їх закриває перший claim доби, а не кожен:
  // нові задачі завжди створюються на сьогодні, тож далі в цій добі закривати нічого. Підзапит потрібен, щоб SQLite вибрав
  // частковий індекс задач у роботі: пряме `UPDATE … WHERE status IN (…)` брало покривний індекс дня й читало всі минулі задачі
  // (≈1260 рядків на виклик, 2026-10-24).
  if(closedPastDays.get(userId)!==today){
    await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='cancelled',active_key=NULL,updated_at=?1,completed_at=?1
      WHERE id IN (SELECT id FROM whatsapp_autopost_jobs WHERE user_id=?2 AND status IN ('pending','claimed') AND published_on<?3)`)
      .bind(now,userId,today).run();
    closedPastDays.set(userId,today);
  }
  for(let attempt=0;attempt<3;attempt+=1){
    // Спершу задачі без невдалих спроб: та, що вже спотикалась, стає в кінець і не блокує решту партії.
    // Проходи «знайти гілки» йдуть першими: від них залежить, які чати взагалі потраплять у публікацію. Окремий пошук по частковому індексу.
    const scanFirst=excluded.includes('telegram')?null:await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
      WHERE user_id=?1 AND status='pending' AND published_on=?2 AND substr(request_key,1,5)='scan_' ORDER BY created_at LIMIT 1`)
      .bind(userId,today).first<WhatsAppAutopostRow>();
    const row=scanFirst||await db.prepare(`SELECT * FROM whatsapp_autopost_jobs
      WHERE user_id=?1 AND status='pending' AND published_on=?2${excluded.length?` AND COALESCE(platform,'') NOT IN (${excluded.map((_,index)=>`?${index+3}`).join(',')})`:''}${options.skipTelegramSends?` AND NOT (COALESCE(platform,'')='telegram' AND request_key NOT LIKE 'scan\\_%' ESCAPE '\\')`:''}
      ORDER BY attempts,created_at,id LIMIT 1`).bind(userId,today,...excluded).first<WhatsAppAutopostRow>();
    if(!row)return null;

    const chat=await readChatState(db,userId,row.chat_id);
    // Прохід «знайти гілки» (Telegram): без матеріалу, правил профілю й публікації; потрібен лише готовий чат цього акаунта.
    if(isScanKey(row.request_key)){
      if(!chat||chat.platform!=='telegram'||chat.workflow_status!=='ready'||!chat.telegram_account_id){
        onSkip?.(row,'scan_chat_unavailable');
        await failWhatsAppAutopostJob(db,userId,row,'stale_precondition',now);
        continue;
      }
      const scanClaim=await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='claimed',updated_at=?1 WHERE id=?2 AND user_id=?3 AND status='pending' RETURNING id`)
        .bind(now,row.id,userId).all<{id:string}>();
      if(scanClaim.results.length!==1)continue;
      const [account,thread]=await Promise.all([readTelegramAutopostAccount(db,userId,chat.telegram_account_id),readTelegramThreadState(db,userId,row.chat_id)]);
      return {
        kind:'telegram_autopost',jobId:row.id,mode:'scan',
        target:{chatId:row.chat_id,expectedName:row.expected_name,expectedLink:row.expected_link},
        material:{advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),language:row.language,text:'',media:null},
        publishedOn:row.published_on,
        telegram:{accountId:chat.telegram_account_id,accountName:account?.name||'',webUserId:account?.web_user_id||null,forum:thread.forum,thread:thread.thread,topics:thread.topics},
        safety:{createsPublication:'after_confirmed_send',requiresTargetVerification:true,requiresSendConfirmation:true},
      };
    }
    const material=await db.prepare(`SELECT version,uk_text,ru_text,archived_at FROM library_items
      WHERE id=?1 AND user_id=?2 AND kind='advertisement' LIMIT 1`)
      .bind(row.advertisement_id,userId).first<{version:number;uk_text:string;ru_text:string;archived_at:number|null}>();
    const publication=await db.prepare(`SELECT id FROM chat_publications
      WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(userId,row.chat_id,row.published_on).first<{id:string}>();
    const discovery=await db.prepare(`SELECT decision FROM chat_discovery_candidates
      WHERE user_id=?1 AND imported_chat_id=?2 AND id NOT LIKE 'waiting-%' ORDER BY updated_at DESC,id LIMIT 1`)
      .bind(userId,row.chat_id).first<{decision:string}>();
    const customMaterial=isCustomAutopostMaterial(userId,row.advertisement_id);
    const selection=chat ? await readPublicationAdvertisementSelection(db,{userId,chatId:row.chat_id,date:row.published_on,excludeAutomationJobId:row.id,withItems:!customMaterial}) : null;
    const selected=selection?.items.find(item=>item.id===row.advertisement_id);
    const platform:AutopostPlatform|null=chat&&(chat.platform==='whatsapp'||chat.platform==='viber'||chat.platform==='telegram')?chat.platform:null;
    let telegramProblem='';
    if(platform==='telegram'&&chat){
      try{await assertTelegramJobAllowed(db,userId,row.chat_id,chat.telegram_account_id);}
      catch(error){
        if(!(error instanceof MessengerAutomationError))throw error;
        telegramProblem=error.code;
      }
    }
    // Telegram: фото могли додати після створення задачі, а підпис до фото не довший за 1024 символи.
    if(platform==='telegram'&&row.payload_text.trim()&&textLength(row.payload_text)>TELEGRAM_PHOTO_CAPTION_LIMIT&&!row.request_key.startsWith('verify_')&&await hasWhatsAppAutopostImage(db,userId,'telegram')){
      onSkip?.(row,'caption_too_long');
      await failWhatsAppAutopostJob(db,userId,row,'caption_too_long',now);
      continue;
    }
    // Гілку чату з форумом ще не вибрано (або її скинуло: вона зникла чи закрилась): це рішення власника, а не збій чату.
    if(telegramProblem==='thread_required'){
      onSkip?.(row,'thread_required');
      await failWhatsAppAutopostJob(db,userId,row,'thread_required',now);
      continue;
    }
    const valid=Boolean(!telegramProblem&&
      chat&&platform&&chat.workflow_status==='ready'&&chat.state_token===row.chat_state_token
      &&!publication&&(!discovery||discovery.decision==='target')&&material
      &&(customMaterial||!material.archived_at)
      &&(customMaterial||Number(material.version)===Number(row.advertisement_version))
      &&selection?.publicationAllowed&&(customMaterial||selected?.selectable)
      &&row.payload_text.trim().length>0
    );
    if(!valid){
      onSkip?.(row,!chat?'chat_missing':!platform?'platform_unsupported':chat.workflow_status!=='ready'?`chat_${chat.workflow_status}`
        :chat.state_token!==row.chat_state_token?'chat_changed':publication?'already_published'
        :discovery&&discovery.decision!=='target'?'discovery_decision':!material?'material_missing'
        :!customMaterial&&material.archived_at?'material_archived':!customMaterial&&Number(material.version)!==Number(row.advertisement_version)?'material_version'
        :!selection?.publicationAllowed?'publication_not_allowed':!customMaterial&&!selected?.selectable?'material_not_selectable':'empty_text');
      await failWhatsAppAutopostJob(db,userId,row,'stale_precondition',now);
      continue;
    }
    // Рахуємо повернені рядки, а не `meta.changes`: D1 додає до нього рядки, які пишуть тригери лічильників (0050), і «1» ніколи не виходило.
    const claimed=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='claimed',updated_at=?1 WHERE id=?2 AND user_id=?3 AND status='pending' RETURNING id`)
      .bind(now,row.id,userId).all<{id:string}>();
    if(claimed.results.length!==1)continue;
    // Фото одне на обидві платформи (його оператор додає на вкладці автопоста WhatsApp); підпис Viber бере з Бібліотеки.
    const verifyMode=row.request_key.startsWith('verify_');
    const image=verifyMode?null:await readWhatsAppAutopostImage(db,userId,true,platform==='telegram'?'telegram':'shared');
    let telegram:WhatsAppAutopostTask['telegram']|undefined;
    if(platform==='telegram'&&chat?.telegram_account_id){
      const [account,thread]=await Promise.all([readTelegramAutopostAccount(db,userId,chat.telegram_account_id),readTelegramThreadState(db,userId,row.chat_id)]);
      telegram={accountId:chat.telegram_account_id,accountName:account?.name||'',webUserId:account?.web_user_id||null,forum:thread.forum,thread:thread.thread,topics:thread.topics};
    }
    const batchMatch=row.request_key.match(BATCH_KEY);
    const batch=batchMatch?await readAutopostBatch(db,userId,platform||'whatsapp',row.published_on,batchMatch[2]):null;
    const sinceEpoch=verifyMode&&row.lease_expires_at!==null&&Number(row.lease_expires_at)>0?Number(row.lease_expires_at):0;
    return {
      kind:platform==='viber'?'viber_android':platform==='telegram'?'telegram_autopost':'whatsapp_autopost',
      jobId:row.id,
      progress:batch?{done:batch.sent+batch.failed+batch.skipped,total:batch.total}:undefined,
      mode:verifyMode?'verify':'send',
      verify:verifyMode?{sinceEpoch}:undefined,
      target:{chatId:row.chat_id,expectedName:row.expected_name,expectedLink:row.expected_link},
      material:{
        advertisementId:row.advertisement_id,advertisementVersion:Number(row.advertisement_version),
        language:row.language,text:row.payload_text,
        media:image?{fileName:image.fileName,contentType:image.contentType,sizeBytes:image.sizeBytes,sha256:image.sha256,base64:image.base64}:null,
      },
      publishedOn:row.published_on,
      ...(telegram?{telegram}:{}),
      safety:{createsPublication:'after_confirmed_send',requiresTargetVerification:true,requiresSendConfirmation:true},
    };
  }
  return null;
}

// A runtime problem (not specific to this job) puts it back to 'pending' without a result — same
// idea as the Waiting-check release, and also what a dropped runner connection does on its own
// (see OwnerChannel.webSocketClose), so a crashed runner can't strand a job in 'claimed' forever.
export async function releaseWhatsAppAutopostJob(db:D1Database,userId:string,jobId:string,now:number,errorCode?:string){
  // Без коду: проблема середовища, а не задачі (runner не готовий, зв'язок обірвався), спроба не рахується.
  if(!errorCode){
    const result=await db.prepare(`UPDATE whatsapp_autopost_jobs
      SET status='pending',updated_at=?1 WHERE id=?2 AND user_id=?3 AND status='claimed' RETURNING id`)
      .bind(now,jobId,userId).all<{id:string}>();
    return result.results.length===1;
  }
  // З кодом: тимчасова помилка саме цієї задачі, до MAX_AUTOPOST_ATTEMPTS спроб, далі пропуск на сьогодні.
  const row=await readWhatsAppAutopostRow(db,userId,jobId);
  if(!row||row.status!=='claimed')return false;
  const settled=await settleAutopostFailure(db,userId,{id:row.id,chat_id:row.chat_id,attempts:Number(row.attempts)||0},
    {errorCode:cleanErrorCode(errorCode)||'adapter_failed',result:{requestedStatus:'released',targetVerified:false,sendConfirmed:false},now});
  return settled.outcome==='retry';
}

// Усі задачі власника, що висять `claimed`: runner, який їх узяв, зник (обрив, перезапуск), і результату вже не буде.
export async function releaseClaimedAutopostJobs(db:D1Database,userId:string,now:number):Promise<string[]>{
  const result=await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='pending',updated_at=?1
    WHERE user_id=?2 AND status='claimed' RETURNING id`).bind(now,userId).all<{id:string}>();
  return result.results.map((row)=>row.id);
}

export async function completeWhatsAppAutopostJob(db:D1Database,userId:string,input:{
  jobId:unknown;status:unknown;observedTarget:unknown;targetVerified:unknown;sendConfirmed:unknown;errorCode?:unknown;scan?:unknown;
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
  const platformRow=await db.prepare(`SELECT platform FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(row.chat_id,userId).first<{platform:string}>();
  const platform=cleanAutopostPlatform(platformRow?.platform);
  // Telegram: що runner побачив у чаті (форум чи ні, список гілок із позначкою «закрита») зберігається при будь-якому результаті.
  if(platform==='telegram'){
    const scan=parseTelegramScan(input.scan);
    if(scan)await applyTelegramScan(db,userId,row.chat_id,scan,now);
  }
  // Прохід «знайти гілки»: результат — що runner побачив у чаті. Задача закривається без публікації, а чат без гілок одразу стає в чергу
  // тієї ж партії (якщо прохід був її частиною).
  if(platform==='telegram'&&isScanKey(row.request_key)&&input.status==='scanned'){
    const scan=parseTelegramScan(input.scan);
    if(scan){
      const closed=await db.prepare(`UPDATE whatsapp_autopost_jobs
        SET status='cancelled',outcome='scanned',active_key=NULL,result_json=?1,updated_at=?2,completed_at=?2
        WHERE id=?3 AND user_id=?4 AND status='claimed' RETURNING id`)
        .bind(JSON.stringify({requestedStatus:'scanned',observedTarget,forum:scan.forum,topics:scan.topics.length}),now,jobId,userId).all<{id:string}>();
      if(closed.results.length!==1)throw new MessengerAutomationError('Задача проходу вже не в роботі.',409);
      let queued=false;
      const batchId=row.request_key.match(SCAN_KEY)?.[1];
      if(!scan.forum&&batchId&&batchId!=='none'){
        const owner=await db.prepare(`SELECT telegram_account_id FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(row.chat_id,userId).first<{telegram_account_id:string|null}>();
        try{
          await createWhatsAppAutopostJob(db,userId,{requestKey:`${batchKeyPrefix('telegram',batchId)}${crypto.randomUUID()}`,chatId:row.chat_id,platform:'telegram',telegramAccountId:owner?.telegram_account_id||null},now,row.published_on);
          queued=true;
        }catch(error){
          // Чат не пройшов перевірки публікації (правила профілю, немає оголошення, довгий текст…): причина лишається в повідомленні, а не в «Не вдалося».
          if(!(error instanceof MessengerAutomationError&&[404,409].includes(error.status)))throw error;
        }
      }
      return {ok:true,status:'scanned',publicationId:null,result:{requestedStatus:'scanned',forum:scan.forum,topics:scan.topics.length,queued}};
    }
  }
  const normalizedExpected=normalizeTarget(row.expected_name);
  const normalizedObserved=normalizeTarget(observedTarget);
  const looseExpected=looseTarget(row.expected_name);
  const looseObserved=looseTarget(observedTarget);
  // У Viber назва чату в інтерфейсі не читається: ціль підтверджує сам помічник (відкриття за посиланням, єдиний збіг
  // у вікні пересилання, збіг аватара, поява повідомлення), тож збіг назви тут не перевіряється.
  const exactTarget=platform==='viber'||platform==='telegram'?targetVerified:(Boolean(normalizedExpected)&&normalizedObserved===normalizedExpected)||(
    sendConfirmed&&Boolean(looseExpected)&&looseObserved===looseExpected
  );
  if(!requestedSent||!targetVerified||!exactTarget||!sendConfirmed){
    const errorCode=cleanErrorCode(input.errorCode)||(
      !targetVerified||!exactTarget?'target_not_verified':!sendConfirmed?'send_not_confirmed':'adapter_failed'
    );
    const result={requestedStatus:requestedSent?'sent':'failed',observedTarget,targetVerified,sendConfirmed,errorCode};
    // Що далі з чатом (архів, «Очікування», повтор, відкласти, рішення власника), визначає політика за кодом помилки.
    const settled=await settleAutopostFailure(db,userId,{id:row.id,chat_id:row.chat_id,attempts:Number(row.attempts)||0},{errorCode,result,now});
    return {ok:true,status:settled.outcome==='retry'?'pending':'failed',publicationId:null,result:{...result,outcome:settled.outcome}};
  }

  const sourceKey=`${platform}-autopost:${row.id}`;
  const publication=await recordConfirmedWhatsappAutopostPublication(db,{
    userId,chatId:row.chat_id,advertisementId:row.advertisement_id,language:row.language,
    now,date:row.published_on,sourceKey,automationJobId:row.id,platform,
  });
  if(!publication.ok){
    const result={requestedStatus:'sent',observedTarget,targetVerified,sendConfirmed,errorCode:'publication_reconcile_failed',publicationError:publication.error};
    // Повідомлення вже пішло, а облік не записався: власник вирішує, не повторюємо.
    const settled=await settleAutopostFailure(db,userId,{id:row.id,chat_id:row.chat_id,attempts:Number(row.attempts)||0},{errorCode:'publication_reconcile_failed',result,now});
    return {ok:false,status:'failed',publicationId:null,result:{...result,outcome:settled.outcome}};
  }

  const result={requestedStatus:'sent',observedTarget,targetVerified:true,sendConfirmed:true,errorCode:null,publicationId:publication.publicationId};
  const update=await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='sent',active_key=NULL,publication_id=?1,result_json=?2,updated_at=?3,completed_at=?3
    WHERE id=?4 AND user_id=?5 AND status='claimed' RETURNING id`)
    .bind(publication.publicationId,JSON.stringify(result),now,jobId,userId).all<{id:string}>();
  if(update.results.length!==1){
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

async function failWhatsAppAutopostJob(db:D1Database,userId:string,row:WhatsAppAutopostRow,errorCode:string,now:number){
  await settleAutopostFailure(db,userId,{id:row.id,chat_id:row.chat_id,attempts:Number(row.attempts)||0},
    {errorCode,result:{requestedStatus:'failed',targetVerified:false,sendConfirmed:false},now});
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
