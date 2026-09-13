import { businessDate } from '../business-time.ts';

const CHAT_LIMIT = 50;

export type HistoricalPublicationChat = {
  id:string; name:string; link:string; platform:string; status:string;
  telegramAccountId:string|null;
};
export type HistoricalPublicationAccount = {
  id:string; number:number; name:string; enabled:boolean;
};
export type HistoricalPublicationAdvertisement = {
  id:string; title:string;
};
export type HistoricalPublicationOptions = {
  chats:HistoricalPublicationChat[];
  accounts:HistoricalPublicationAccount[];
  advertisements:HistoricalPublicationAdvertisement[];
};

export class ReportCorrectionError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.name='ReportCorrectionError';this.status=status;}
}

export async function readHistoricalPublicationOptions(db:D1Database,input:{
  userId:string;date:string;search?:string;platform?:string|null;
}):Promise<HistoricalPublicationOptions>{
  validateAccountingDate(input.date,Math.floor(Date.now()/1000));
  const search=(input.search||'').trim().slice(0,120).toLocaleLowerCase('uk-UA');
  const pattern=`%${escapeLike(search)}%`;
  const platform=input.platform&&['telegram','whatsapp','viber','facebook'].includes(input.platform)?input.platform:'';
  const [chats,accounts,advertisements]=await db.batch([
    db.prepare(`SELECT c.id,c.name,c.link,c.platform,c.workflow_status,c.telegram_account_id
      FROM chats c
      WHERE c.user_id=?1
        AND (?2='' OR c.platform=?2)
        AND (?3='' OR lower(c.name) LIKE ?4 ESCAPE '\\' OR lower(c.link) LIKE ?4 ESCAPE '\\')
        AND NOT EXISTS(SELECT 1 FROM chat_publications p
          WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?5)
      ORDER BY CASE c.workflow_status WHEN 'ready' THEN 0 WHEN 'archived' THEN 1 WHEN 'to_join' THEN 2 ELSE 3 END,
        c.updated_at DESC,c.name LIMIT ${CHAT_LIMIT}`)
      .bind(input.userId,platform,search,pattern,input.date),
    db.prepare(`SELECT id,account_number,name,is_enabled FROM telegram_accounts
      WHERE user_id=?1 ORDER BY account_number`).bind(input.userId),
    db.prepare(`SELECT id,title FROM library_items
      WHERE user_id=?1 AND kind='advertisement' AND archived_at IS NULL
      ORDER BY updated_at DESC,title LIMIT 200`).bind(input.userId),
  ]);
  return {
    chats:(chats.results as Array<Record<string,unknown>>).map(row=>({
      id:String(row.id),name:String(row.name),link:String(row.link),platform:String(row.platform),
      status:String(row.workflow_status),telegramAccountId:typeof row.telegram_account_id==='string'?row.telegram_account_id:null,
    })),
    accounts:(accounts.results as Array<Record<string,unknown>>).map(row=>({
      id:String(row.id),number:Number(row.account_number),name:String(row.name),enabled:Boolean(row.is_enabled),
    })),
    advertisements:(advertisements.results as Array<Record<string,unknown>>).map(row=>({id:String(row.id),title:String(row.title)})),
  };
}

export async function recordHistoricalPublication(db:D1Database,input:{
  userId:string;chatId:string;date:string;now:number;
  telegramAccountId?:string|null;advertisementId?:string|null;language?:'uk'|'ru'|null;
}):Promise<{publicationId:string;eventId:string}>{
  validateAccountingDate(input.date,input.now);
  const chat=await db.prepare(`SELECT id,platform,telegram_account_id FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(input.chatId,input.userId).first<{id:string;platform:string;telegram_account_id:string|null}>();
  if(!chat)throw new ReportCorrectionError('Чат не знайдено.',404);
  const accountId=chat.platform==='telegram'?(input.telegramAccountId||chat.telegram_account_id||null):null;
  if(chat.platform==='telegram'&&!accountId)throw new ReportCorrectionError('Оберіть Telegram-акаунт для історичної публікації.');
  if(chat.platform!=='telegram'&&input.telegramAccountId)throw new ReportCorrectionError('Telegram-акаунт можна вказати лише для Telegram.');
  if(accountId){
    const account=await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(accountId,input.userId).first();
    if(!account)throw new ReportCorrectionError('Telegram-акаунт не належить цьому workspace.',409);
  }
  const advertisementId=input.advertisementId||null;
  if(advertisementId){
    const advertisement=await db.prepare(`SELECT id FROM library_items WHERE id=?1 AND user_id=?2 AND kind='advertisement' AND archived_at IS NULL LIMIT 1`)
      .bind(advertisementId,input.userId).first();
    if(!advertisement)throw new ReportCorrectionError('Оголошення не знайдено або воно в архіві.',409);
  }
  const language=input.language==='uk'||input.language==='ru'?input.language:null;
  const publicationId=crypto.randomUUID();
  const eventId=crypto.randomUUID();
  const sourceKey=`report-publication:${publicationId}`;
  const metadata:Record<string,unknown>={correction:'historical_report',accountingDate:input.date};
  if(advertisementId)metadata.advertisementId=advertisementId;
  if(language)metadata.language=language;
  const results=await db.batch([
    db.prepare(`INSERT INTO chat_publications
      (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at,telegram_account_id)
      SELECT ?1,c.user_id,c.id,?2,?3,?4,'report_correction',?5,?3,?6
      FROM chats c WHERE c.id=?7 AND c.user_id=?8
      ON CONFLICT(user_id,chat_id,published_on) DO NOTHING`)
      .bind(publicationId,input.date,input.now,advertisementId,sourceKey,accountId,input.chatId,input.userId),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,p.user_id,'publication',c.platform,p.chat_id,?2,p.published_on,?3,p.source_key,p.telegram_account_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.id=?4 AND p.user_id=?5`)
      .bind(eventId,input.now,JSON.stringify(metadata),publicationId,input.userId),
  ]);
  if(!results[0].meta.changes)throw new ReportCorrectionError('Для цього чату за вибрану дату публікація вже існує.',409);
  if(!results[1].meta.changes)throw new ReportCorrectionError('Не вдалося зафіксувати подію публікації.',409);
  return {publicationId,eventId};
}

export function validateAccountingDate(date:string,now:number){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ReportCorrectionError('Некоректна дата обліку.');
  const parsed=new Date(`${date}T12:00:00Z`);
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new ReportCorrectionError('Некоректна дата обліку.');
  if(date>businessDate(now))throw new ReportCorrectionError('Дата обліку не може бути в майбутньому.');
}
function escapeLike(value:string){return value.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');}
