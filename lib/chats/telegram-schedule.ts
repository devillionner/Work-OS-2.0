import { isoWeekday, profilePublicationEligibilitySql } from './profile.ts';

export class TelegramScheduleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type TelegramScheduleSettings = {
  intervalMinutes: number; baseAt: number; selectionMode: 'auto' | 'manual';
  manualChatIds: string[]; version: number;
};
export type TelegramScheduleChat = { id:string; name:string; link:string };
export type TelegramScheduleSlot = {
  id:string; sequence:number; scheduledAt:number; chatId:string|null; chatName:string|null;
  chatLink:string|null; status:'pending'|'completed'; completedAt:number|null; version:number;
};
export type TelegramScheduleSnapshot = {
  accountId:string; settings:TelegramScheduleSettings; eligibleChats:TelegramScheduleChat[];
  slots:TelegramScheduleSlot[]; pending:number; completed:number; nextSlot:TelegramScheduleSlot|null;
};

const DEFAULT_INTERVAL_MINUTES = 60 / 7;
const MAX_MANUAL_CHATS = 500;
const MAX_SLOTS = 200;

export function intervalMinutesForRate(ratePerHour:number) {
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) throw new TelegramScheduleError('Темп має бути більшим за нуль.');
  return 60 / ratePerHour;
}
export function ratePerHourForInterval(intervalMinutes:number) {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new TelegramScheduleError('Інтервал має бути більшим за нуль.');
  return 60 / intervalMinutes;
}

export async function readTelegramSchedule(db:D1Database,input:{userId:string;accountId:string;now:number;date:string;search?:string}):Promise<TelegramScheduleSnapshot> {
  await requireAccount(db,input.userId,input.accountId);
  const row=await db.prepare(`SELECT interval_minutes,base_at,selection_mode,manual_chat_ids_json,version
    FROM telegram_schedule_settings WHERE user_id=?1 AND telegram_account_id=?2`).bind(input.userId,input.accountId).first<Record<string,unknown>>();
  const settings=parseSettings(row,input.now);
  const eligibleChats=await eligibleTelegramChats(db,{...input,excludePending:false});
  const slotResult=await db.prepare(`SELECT s.id,s.sequence,s.scheduled_at,s.chat_id,s.status,s.completed_at,s.version,c.name chat_name,c.link chat_link
    FROM telegram_schedule_slots s LEFT JOIN chats c ON c.id=s.chat_id AND c.user_id=s.user_id
    WHERE s.user_id=?1 AND s.telegram_account_id=?2 ORDER BY s.scheduled_at DESC,s.sequence DESC LIMIT 100`)
    .bind(input.userId,input.accountId).all<Record<string,unknown>>();
  const slots=slotResult.results.map(slotView).reverse();
  const pending=slots.filter(slot=>slot.status==='pending').length;
  const completed=slots.filter(slot=>slot.status==='completed').length;
  const nextSlot=slots.filter(slot=>slot.status==='pending').sort((a,b)=>a.scheduledAt-b.scheduledAt||a.sequence-b.sequence)[0]||null;
  return {accountId:input.accountId,settings,eligibleChats,slots,pending,completed,nextSlot};
}

export async function saveTelegramScheduleSettings(db:D1Database,input:{
  userId:string;accountId:string;expectedVersion:number;intervalMinutes:number;baseAt:number;
  selectionMode:'auto'|'manual';manualChatIds:string[];now:number;date:string;
}) {
  await requireAccount(db,input.userId,input.accountId);
  const interval=validInterval(input.intervalMinutes);
  const baseAt=validEpoch(input.baseAt,'Некоректний час старту.');
  const manualChatIds=uniqueIds(input.manualChatIds);
  if(manualChatIds.length>MAX_MANUAL_CHATS) throw new TelegramScheduleError(`Можна вибрати не більше ${MAX_MANUAL_CHATS} чатів.`);
  if(input.selectionMode==='manual'&&manualChatIds.length) await assertSelectableChats(db,input.userId,input.accountId,manualChatIds,input.now,input.date);
  const manualJson=JSON.stringify(manualChatIds);
  let changes=0;
  if(input.expectedVersion===0) {
    const result=await db.prepare(`INSERT OR IGNORE INTO telegram_schedule_settings
      (user_id,telegram_account_id,interval_minutes,base_at,selection_mode,manual_chat_ids_json,updated_at,version)
      VALUES (?1,?2,?3,?4,?5,?6,?7,1)`).bind(input.userId,input.accountId,interval,baseAt,input.selectionMode,manualJson,input.now).run();
    changes=Number(result.meta.changes||0);
  } else {
    const result=await db.prepare(`UPDATE telegram_schedule_settings SET interval_minutes=?1,base_at=?2,selection_mode=?3,
      manual_chat_ids_json=?4,updated_at=?5,version=version+1 WHERE user_id=?6 AND telegram_account_id=?7 AND version=?8`)
      .bind(interval,baseAt,input.selectionMode,manualJson,input.now,input.userId,input.accountId,input.expectedVersion).run();
    changes=Number(result.meta.changes||0);
  }
  if(!changes) throw new TelegramScheduleError('Налаштування розкладу вже змінилися. Оновіть дані.',409);
  return readTelegramSchedule(db,{userId:input.userId,accountId:input.accountId,now:input.now,date:input.date});
}
export async function generateTelegramSchedule(db:D1Database,input:{userId:string;accountId:string;count:number;now:number;date:string}) {
  await requireAccount(db,input.userId,input.accountId);
  const count=Math.trunc(input.count);
  if(!Number.isFinite(count)||count<1||count>MAX_SLOTS) throw new TelegramScheduleError(`Кількість слотів має бути від 1 до ${MAX_SLOTS}.`);
  const stored=await db.prepare(`SELECT interval_minutes,base_at,selection_mode,manual_chat_ids_json,version FROM telegram_schedule_settings
    WHERE user_id=?1 AND telegram_account_id=?2`).bind(input.userId,input.accountId).first<Record<string,unknown>>();
  const settings=parseSettings(stored,input.now);
  const eligible=await eligibleTelegramChats(db,{...input,excludePending:true});
  const eligibleMap=new Map(eligible.map(chat=>[chat.id,chat]));
  const source=settings.selectionMode==='manual'
    ? settings.manualChatIds.map(id=>eligibleMap.get(id)).filter((chat):chat is TelegramScheduleChat=>Boolean(chat))
    : eligible;
  if(settings.selectionMode==='manual'&&source.length<count) {
    throw new TelegramScheduleError(`Для ${count} слотів доступно лише ${source.length} із вибраних чатів. Виберіть ще чати або зменште кількість слотів.`,409);
  }
  const max=await db.prepare(`SELECT COALESCE(MAX(sequence),0) n FROM telegram_schedule_slots WHERE user_id=?1 AND telegram_account_id=?2`)
    .bind(input.userId,input.accountId).first<{n?:number}>();
  const startSequence=Number(max?.n||0);
  const intervalSeconds=settings.intervalMinutes*60;
  const statements=[];
  for(let i=0;i<count;i++) {
    const scheduledAt=roundMillis(settings.baseAt+intervalSeconds*(i+1));
    const id=slotId(input.accountId,scheduledAt);
    const chatId=source[i]?.id||null;
    statements.push(db.prepare(`INSERT OR IGNORE INTO telegram_schedule_slots
      (id,user_id,telegram_account_id,sequence,scheduled_at,chat_id,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?7)`)
      .bind(id,input.userId,input.accountId,startSequence+i+1,scheduledAt,chatId,input.now));
  }
  if(statements.length) await db.batch(statements);
  return readTelegramSchedule(db,{userId:input.userId,accountId:input.accountId,now:input.now,date:input.date});
}

export async function updateTelegramScheduleSlot(db:D1Database,input:{userId:string;accountId:string;slotId:string;expectedVersion:number;scheduledAt?:number;chatId?:string|null;now:number;date:string}) {
  await requireAccount(db,input.userId,input.accountId);
  if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0) throw new TelegramScheduleError('Некоректна версія слота.');
  if(input.scheduledAt===undefined&&input.chatId===undefined) return readTelegramSchedule(db,{userId:input.userId,accountId:input.accountId,now:input.now,date:input.date});
  const scheduledAt=input.scheduledAt===undefined?null:roundMillis(validEpoch(input.scheduledAt,'Некоректний час слота.'));
  if(input.chatId!==undefined&&input.chatId!==null) await assertSelectableChats(db,input.userId,input.accountId,[input.chatId],input.now,input.date);
  try {
    const result=input.scheduledAt!==undefined&&input.chatId!==undefined
      ? await db.prepare(`UPDATE telegram_schedule_slots SET scheduled_at=?1,chat_id=?2,updated_at=?3,version=version+1
          WHERE id=?4 AND user_id=?5 AND telegram_account_id=?6 AND status='pending' AND version=?7`)
          .bind(scheduledAt,input.chatId,input.now,input.slotId,input.userId,input.accountId,input.expectedVersion).run()
      : input.scheduledAt!==undefined
        ? await db.prepare(`UPDATE telegram_schedule_slots SET scheduled_at=?1,updated_at=?2,version=version+1
            WHERE id=?3 AND user_id=?4 AND telegram_account_id=?5 AND status='pending' AND version=?6`)
            .bind(scheduledAt,input.now,input.slotId,input.userId,input.accountId,input.expectedVersion).run()
        : await db.prepare(`UPDATE telegram_schedule_slots SET chat_id=?1,updated_at=?2,version=version+1
            WHERE id=?3 AND user_id=?4 AND telegram_account_id=?5 AND status='pending' AND version=?6`)
            .bind(input.chatId??null,input.now,input.slotId,input.userId,input.accountId,input.expectedVersion).run();
    if(!result.meta.changes) throw new TelegramScheduleError('Слот уже змінився. Оновіть розклад.',409);
  } catch(reason) {
    if(reason instanceof TelegramScheduleError) throw reason;
    throw new TelegramScheduleError('Не вдалося зберегти слот через конфлікт розкладу.',409);
  }
  return readTelegramSchedule(db,{userId:input.userId,accountId:input.accountId,now:input.now,date:input.date});
}

export async function clearPendingTelegramSchedule(db:D1Database,input:{userId:string;accountId:string;now:number;date:string}) {
  await requireAccount(db,input.userId,input.accountId);
  await db.prepare(`DELETE FROM telegram_schedule_slots WHERE user_id=?1 AND telegram_account_id=?2 AND status='pending'`).bind(input.userId,input.accountId).run();
  return readTelegramSchedule(db,input);
}
async function eligibleTelegramChats(db:D1Database,input:{userId:string;accountId:string;now:number;date:string;search?:string;excludePending:boolean}):Promise<TelegramScheduleChat[]> {
  const search=(input.search||'').trim().slice(0,150).toLowerCase();
  const pattern=`%${escapeLike(search)}%`;
  const pending=input.excludePending ? ` AND NOT EXISTS(SELECT 1 FROM telegram_schedule_slots s WHERE s.user_id=c.user_id AND s.telegram_account_id=?2 AND s.chat_id=c.id AND s.status='pending')` : '';
  const result=await db.prepare(`SELECT c.id,c.name,c.link FROM chats c
    WHERE c.user_id=?1 AND c.platform='telegram' AND c.telegram_account_id=?2 AND c.workflow_status='ready'
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?3)
      AND (c.joined_at IS NULL OR c.joined_at+21600<=?3)
      AND (?5='' OR lower(c.name) LIKE ?6 ESCAPE '\\' OR lower(c.link) LIKE ?6 ESCAPE '\\')
      AND NOT EXISTS(SELECT 1 FROM chat_publications p WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?4)
      AND ${profilePublicationEligibilitySql('?4','?7')}
      ${pending}
    ORDER BY COALESCE(c.joined_at,c.created_at),c.updated_at,c.id LIMIT 500`)
    .bind(input.userId,input.accountId,input.now,input.date,search,pattern,isoWeekday(input.date)).all<TelegramScheduleChat>();
  return result.results;
}

async function assertSelectableChats(db:D1Database,userId:string,accountId:string,ids:string[],now:number,date:string) {
  const eligible=await eligibleTelegramChats(db,{userId,accountId,now,date,excludePending:false});
  const set=new Set(eligible.map(chat=>chat.id));
  const missing=ids.filter(id=>!set.has(id));
  if(missing.length) throw new TelegramScheduleError('Частина вибраних чатів уже недоступна для публікації. Оновіть список.',409);
}

async function requireAccount(db:D1Database,userId:string,accountId:string) {
  const account=await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(accountId,userId).first();
  if(!account) throw new TelegramScheduleError('Активний Telegram-акаунт не знайдено.',404);
}

function parseSettings(row:Record<string,unknown>|null,now:number):TelegramScheduleSettings {
  const interval=row ? Number(row.interval_minutes) : DEFAULT_INTERVAL_MINUTES;
  const base=row ? Number(row.base_at) : now;
  let manualChatIds:string[]=[];
  try { const raw=typeof row?.manual_chat_ids_json==='string'?row.manual_chat_ids_json:'[]'; const parsed=JSON.parse(raw); if(Array.isArray(parsed)) manualChatIds=uniqueIds(parsed.filter((value):value is string=>typeof value==='string')); } catch {}
  return {
    intervalMinutes:Number.isFinite(interval)&&interval>0?interval:DEFAULT_INTERVAL_MINUTES,
    baseAt:Number.isFinite(base)&&base>=0?base:now,
    selectionMode:row?.selection_mode==='manual'?'manual':'auto',
    manualChatIds,
    version:Number(row?.version||0),
  };
}
function slotView(row:Record<string,unknown>):TelegramScheduleSlot {
  return {id:String(row.id),sequence:Number(row.sequence),scheduledAt:Number(row.scheduled_at),chatId:typeof row.chat_id==='string'?row.chat_id:null,
    chatName:typeof row.chat_name==='string'?row.chat_name:null,chatLink:typeof row.chat_link==='string'?row.chat_link:null,
    status:row.status==='completed'?'completed':'pending',completedAt:row.completed_at===null||row.completed_at===undefined?null:Number(row.completed_at),version:Number(row.version||0)};
}
function uniqueIds(values:string[]) { return [...new Set(values.map(value=>value.trim()).filter(Boolean))]; }
function validInterval(value:number) { if(!Number.isFinite(value)||value<=0) throw new TelegramScheduleError('Інтервал має бути більшим за нуль.'); return value; }
function validEpoch(value:number,message:string) { if(!Number.isFinite(value)||value<0) throw new TelegramScheduleError(message); return value; }
function roundMillis(value:number) { return Math.round(value*1000)/1000; }
function slotId(_accountId:string,_scheduledAt:number) { return crypto.randomUUID(); }
function escapeLike(value:string) { return value.replace(/[\\%_]/g,'\\$&'); }
