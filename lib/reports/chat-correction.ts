import { previewBulkChats } from '../chats/bulk.ts';
import { BulkChatError, normalizeGroupLink, suggestedChatName, validateBulkItems } from '../chats/bulk-input.ts';
import { validateAccountingDate } from './publication-correction.ts';

export type HistoricalChatAccount={id:string;number:number;name:string;enabled:boolean};
export type HistoricalChatCorrectionResult={chatId:string;platform:string;name:string;link:string};

type ReceiptRow={chat_id:string;metadata_json:string};

export async function readHistoricalChatAccounts(db:D1Database,userId:string):Promise<HistoricalChatAccount[]>{
  const result=await db.prepare(`SELECT id,account_number,name,is_enabled FROM telegram_accounts
    WHERE user_id=?1 ORDER BY account_number`).bind(userId).all<{id:string;account_number:number;name:string;is_enabled:number}>();
  return result.results.map(row=>({id:row.id,number:Number(row.account_number),name:row.name,enabled:Boolean(row.is_enabled)}));
}

export async function recordHistoricalJoinedChat(db:D1Database,input:{
  userId:string;requestId:string;date:string;name:string;link:string;telegramAccountId?:string|null;now:number;
}):Promise<HistoricalChatCorrectionResult>{
  validateAccountingDate(input.date,input.now);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))
    throw new BulkChatError('Некоректний ID запиту.');
  const [raw]=validateBulkItems([{link:input.link,name:input.name}]);
  const parsed=normalizeGroupLink(raw.link);
  if(!parsed)throw new BulkChatError('Некоректне посилання на чат.');
  const name=raw.name||suggestedChatName(parsed);
  const accountId=parsed.platform==='telegram'?(input.telegramAccountId||null):null;
  if(parsed.platform==='telegram'&&!accountId)throw new BulkChatError('Оберіть Telegram-акаунт для історичного чату.');
  if(parsed.platform!=='telegram'&&input.telegramAccountId)throw new BulkChatError('Telegram-акаунт можна вказати лише для Telegram.');
  if(accountId){
    const account=await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(accountId,input.userId).first();
    if(!account)throw new BulkChatError('Telegram-акаунт не належить цьому workspace.',409);
  }
  const hash=await correctionHash({date:input.date,name,link:parsed.link,telegramAccountId:accountId});
  const previous=await correctionReceipt(db,input.userId,input.requestId,hash);
  if(previous)return previous;

  const plan=await previewBulkChats(db,input.userId,[{link:parsed.link,name}]);
  const item=plan.items[0];
  if(!item||item.status!=='new')throw new BulkChatError(item?.status==='archived'?'Цей чат уже є в архіві. Відновіть його замість створення дубліката.':'Цей чат уже існує. Відкрийте наявний запис.',409);

  const chatId=crypto.randomUUID();
  const stateEventId=crypto.randomUUID();
  const joinedEventId=crypto.randomUUID();
  const sourceKey=`report-chat:${input.requestId}`;
  const metadata=JSON.stringify({correction:'historical_report',accountingDate:input.date,exactJoinTime:'unknown',requestHash:hash});
  let results:D1Result[];
  try{
    results=await db.batch([
      db.prepare(`WITH guard AS MATERIALIZED (
        SELECT COALESCE((SELECT revision FROM backup_revisions WHERE user_id=?1),0) AS revision)
        INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,telegram_account_id,created_at,updated_at)
        SELECT ?2,?1,?3,?4,?5,?5,'ready',?6,NULL,NULL,?7,?8,?8 FROM guard WHERE guard.revision=?9`)
        .bind(input.userId,chatId,parsed.platform,name,parsed.link,Number(parsed.private),accountId,input.now,plan.revision),
      db.prepare(`INSERT INTO activity_events
        (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
        SELECT ?1,c.user_id,'chat_state_changed',c.platform,c.id,?2,?3,?4,?5,c.telegram_account_id
        FROM chats c WHERE c.id=?6 AND c.user_id=?7 AND changes()=1`)
        .bind(stateEventId,input.now,input.date,JSON.stringify({action:'historical_joined',correction:'historical_report',accountingDate:input.date,exactJoinTime:'unknown'}),`report-chat-state:${input.requestId}`,chatId,input.userId),
      db.prepare(`INSERT INTO activity_events
        (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
        SELECT ?1,c.user_id,'chat_joined',c.platform,c.id,?2,?3,?4,?5,c.telegram_account_id
        FROM chats c WHERE c.id=?6 AND c.user_id=?7
          AND EXISTS(SELECT 1 FROM activity_events e WHERE e.id=?8 AND e.user_id=?7)`)
        .bind(joinedEventId,input.now,input.date,metadata,sourceKey,chatId,input.userId,stateEventId),
    ]);
  }catch(error){
    const raced=await correctionReceipt(db,input.userId,input.requestId,hash);
    if(raced)return raced;
    throw error;
  }
  if(results[0].meta.changes&&results[2].meta.changes)return {chatId,platform:parsed.platform,name,link:parsed.link};
  const raced=await correctionReceipt(db,input.userId,input.requestId,hash);
  if(raced)return raced;
  throw new BulkChatError('Дані чатів змінилися під час корекції. Перевірте запис ще раз.',409);
}

async function correctionReceipt(db:D1Database,userId:string,requestId:string,hash:string):Promise<HistoricalChatCorrectionResult|null>{
  const row=await db.prepare(`SELECT e.chat_id,e.metadata_json FROM activity_events e
    WHERE e.user_id=?1 AND e.event_type='chat_joined' AND e.source_key=?2 LIMIT 1`)
    .bind(userId,`report-chat:${requestId}`).first<ReceiptRow>();
  if(!row)return null;
  let metadata:Record<string,unknown>={};
  try{const parsed:unknown=JSON.parse(row.metadata_json);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))metadata=parsed as Record<string,unknown>;}catch{}
  if(metadata.requestHash!==hash)throw new BulkChatError('Цей ID запиту вже використано для іншої корекції.',409);
  const chat=await db.prepare(`SELECT id,platform,name,link FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(row.chat_id,userId).first<{id:string;platform:string;name:string;link:string}>();
  if(!chat)throw new BulkChatError('Історичний чат більше не доступний.',409);
  return {chatId:chat.id,platform:chat.platform,name:chat.name,link:chat.link};
}

async function correctionHash(value:unknown){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
