import { cleanChatName, normalizeGroupLink, type ChatPlatform } from './bulk-input.ts';

export const CHAT_CSV_VERSION = 'work-os-chat-csv-v1';
export const CHAT_CSV_MAX_ROWS = 10_000;
export const CHAT_CSV_MAX_BYTES = 5 * 1024 * 1024;

const STATUSES = new Set(['to_join','waiting','ready','archived']);
const CADENCES = new Set(['any','daily','several_week','weekly','monthly','custom']);
const HEADER = [
  'work_os_chat_csv_version','platform','name','link','workflow_status','joined_at','processed_at',
  'snoozed_until','archive_reason','archived_at','created_at','updated_at','telegram_account_number',
  'has_profile','profile_language','profile_cadence','profile_weekdays_json','profile_custom_interval_days',
  'profile_next_allowed_on','profile_directions_json','profile_note','profile_review_status',
] as const;

type CsvColumn = (typeof HEADER)[number];
export type ChatCsvRow = Record<CsvColumn,string>;
export type ChatCsvImportRow = {
  rowNumber:number; platform:ChatPlatform; name:string; link:string; normalizedLink:string; private:boolean;
  workflowStatus:'to_join'|'waiting'|'ready'|'archived'; joinedAt:number|null; processedAt:number|null;
  snoozedUntil:number|null; archiveReason:string|null; archivedAt:number|null; createdAt:number; updatedAt:number;
  telegramAccountNumber:number|null; profile:null|{
    language:'uk'|'ru'|null; cadence:'any'|'daily'|'several_week'|'weekly'|'monthly'|'custom'; weekdays:number[];
    customIntervalDays:number|null; nextAllowedOn:string|null; directions:string[]; note:string; reviewStatus:'draft'|'confirmed';
  };
};
export type ChatCsvPreview = {
  revision:number; total:number; add:number; existing:number; conflicts:string[];
  byPlatform:Record<ChatPlatform,{total:number;add:number;existing:number}>;
  rows:ChatCsvImportRow[];
};

type ExportRow = {
  platform:string;name:string;link:string;workflow_status:string;joined_at:number|null;processed_at:number|null;
  snoozed_until:number|null;archive_reason:string|null;archived_at:number|null;created_at:number;updated_at:number;
  telegram_account_number:number|null;profile_chat_id:string|null;profile_language:string|null;profile_cadence:string|null;
  profile_weekdays_json:string|null;profile_custom_interval_days:number|null;profile_next_allowed_on:string|null;
  profile_directions_json:string|null;profile_note:string|null;profile_review_status:string|null;
};

export class ChatCsvError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.name='ChatCsvError';this.status=status;}
}

export function serializeChatCsv(rows:ChatCsvRow[]) {
  return '\ufeff'+[HEADER.join(','),...rows.map(row=>HEADER.map(key=>csvCell(row[key])).join(','))].join('\r\n');
}

export function parseChatCsv(text:string):ChatCsvImportRow[] {
  const records=parseCsvRecords(text.replace(/^\ufeff/,''));
  if(!records.length)throw new ChatCsvError('CSV порожній.');
  if(records.length-1>CHAT_CSV_MAX_ROWS)throw new ChatCsvError(`CSV підтримує до ${CHAT_CSV_MAX_ROWS} чатів за один імпорт.`);
  const header=records[0];
  if(header.length!==HEADER.length||HEADER.some((key,index)=>header[index]!==key))throw new ChatCsvError('Невідомий формат CSV. Експортуйте файл із Work OS 2.0.');
  const seen=new Set<string>();
  return records.slice(1).filter(record=>record.some(value=>value!=='' )).map((record,index)=>{
    const rowNumber=index+2;
    if(record.length!==HEADER.length)throw new ChatCsvError(`Рядок ${rowNumber}: неправильна кількість колонок.`);
    const raw=Object.fromEntries(HEADER.map((key,column)=>[key,restoreSpreadsheetText(record[column]??'')])) as ChatCsvRow;
    if(raw.work_os_chat_csv_version!==CHAT_CSV_VERSION)throw new ChatCsvError(`Рядок ${rowNumber}: непідтримувана версія CSV.`);
    const parsedLink=normalizeGroupLink(raw.link);
    if(!parsedLink)throw new ChatCsvError(`Рядок ${rowNumber}: некоректне посилання.`);
    if(parsedLink.platform!==raw.platform)throw new ChatCsvError(`Рядок ${rowNumber}: платформа не відповідає посиланню.`);
    if(seen.has(parsedLink.link))throw new ChatCsvError(`Рядок ${rowNumber}: канонічне посилання повторюється у CSV.`);
    seen.add(parsedLink.link);
    const name=cleanChatName(raw.name);
    if(!name)throw new ChatCsvError(`Рядок ${rowNumber}: порожня назва чату.`);
    if(!STATUSES.has(raw.workflow_status))throw new ChatCsvError(`Рядок ${rowNumber}: невідомий стан чату.`);
    const workflowStatus=raw.workflow_status as ChatCsvImportRow['workflowStatus'];
    const telegramAccountNumber=optionalPositiveInt(raw.telegram_account_number,rowNumber,'Telegram account number');
    if(parsedLink.platform!=='telegram'&&telegramAccountNumber!==null)throw new ChatCsvError(`Рядок ${rowNumber}: Telegram account number дозволений лише для Telegram.`);
    if(parsedLink.platform==='telegram'&&workflowStatus!=='to_join'&&telegramAccountNumber===null)throw new ChatCsvError(`Рядок ${rowNumber}: для Telegram-стану «${workflowStatus}» потрібен номер акаунта.`);
    const hasProfile=raw.has_profile==='1';
    if(raw.has_profile!=='0'&&!hasProfile)throw new ChatCsvError(`Рядок ${rowNumber}: has_profile має бути 0 або 1.`);
    const profile=hasProfile?parseProfile(raw,rowNumber):null;
    return {
      rowNumber,platform:parsedLink.platform,name,link:parsedLink.link,normalizedLink:parsedLink.link,private:parsedLink.private,
      workflowStatus,joinedAt:optionalEpoch(raw.joined_at,rowNumber,'joined_at'),processedAt:optionalEpoch(raw.processed_at,rowNumber,'processed_at'),
      snoozedUntil:optionalEpoch(raw.snoozed_until,rowNumber,'snoozed_until'),archiveReason:optionalText(raw.archive_reason,100),
      archivedAt:optionalEpoch(raw.archived_at,rowNumber,'archived_at'),createdAt:requiredEpoch(raw.created_at,rowNumber,'created_at'),
      updatedAt:requiredEpoch(raw.updated_at,rowNumber,'updated_at'),telegramAccountNumber,profile,
    };
  });
}

export async function exportChatCsv(db:D1Database,userId:string) {
  const result=await db.prepare(`SELECT c.platform,c.name,c.link,c.workflow_status,c.joined_at,c.processed_at,c.snoozed_until,c.archive_reason,c.archived_at,c.created_at,c.updated_at,
      a.account_number AS telegram_account_number,p.chat_id AS profile_chat_id,p.language AS profile_language,p.cadence AS profile_cadence,
      p.weekdays_json AS profile_weekdays_json,p.custom_interval_days AS profile_custom_interval_days,p.next_allowed_on AS profile_next_allowed_on,
      p.directions_json AS profile_directions_json,p.note AS profile_note,p.review_status AS profile_review_status
    FROM chats c LEFT JOIN telegram_accounts a ON a.id=c.telegram_account_id AND a.user_id=c.user_id
    LEFT JOIN chat_profiles p ON p.chat_id=c.id
    WHERE c.user_id=?1 ORDER BY c.platform,c.updated_at DESC,c.id LIMIT ${CHAT_CSV_MAX_ROWS+1}`).bind(userId).all<ExportRow>();
  if(result.results.length>CHAT_CSV_MAX_ROWS)throw new ChatCsvError(`CSV-експорт підтримує до ${CHAT_CSV_MAX_ROWS} чатів. Для більшої бази використайте повну резервну копію.`,409);
  return serializeChatCsv(result.results.map(exportRow));
}

export async function previewChatCsvImport(db:D1Database,userId:string,rows:ChatCsvImportRow[]):Promise<ChatCsvPreview> {
  const [revisionResult,chatsResult,accountsResult]=await Promise.all([
    db.prepare(`SELECT COALESCE((SELECT revision FROM backup_revisions WHERE user_id=?1),0) revision`).bind(userId).first<{revision:number}>(),
    db.prepare(`SELECT normalized_link FROM chats WHERE user_id=?1 ORDER BY id LIMIT ${CHAT_CSV_MAX_ROWS+1}`).bind(userId).all<{normalized_link:string}>(),
    db.prepare(`SELECT id,account_number FROM telegram_accounts WHERE user_id=?1`).bind(userId).all<{id:string;account_number:number}>(),
  ]);
  if(chatsResult.results.length>CHAT_CSV_MAX_ROWS)throw new ChatCsvError(`CSV-імпорт підтримує workspace до ${CHAT_CSV_MAX_ROWS} чатів. Для більшої бази використайте повну резервну копію.`,409);
  const existing=new Set(chatsResult.results.map(row=>row.normalized_link));
  const accountNumbers=new Set(accountsResult.results.map(row=>Number(row.account_number)));
  const byPlatform=emptyPlatformSummary();
  const conflicts:string[]=[];
  let add=0;let existingCount=0;
  for(const row of rows){
    const bucket=byPlatform[row.platform];bucket.total++;
    if(existing.has(row.normalizedLink)){existingCount++;bucket.existing++;continue;}
    if(row.platform==='telegram'&&row.telegramAccountNumber!==null&&!accountNumbers.has(row.telegramAccountNumber)){
      conflicts.push(`Рядок ${row.rowNumber}: Telegram-акаунт #${row.telegramAccountNumber} не існує у цьому workspace.`);continue;
    }
    add++;bucket.add++;
  }
  return {revision:Number(revisionResult?.revision||0),total:rows.length,add,existing:existingCount,conflicts,byPlatform,rows};
}

export async function applyChatCsvImport(db:D1Database,input:{userId:string;rows:ChatCsvImportRow[];expectedRevision:number;now:number}) {
  const preview=await previewChatCsvImport(db,input.userId,input.rows);
  if(preview.revision!==input.expectedRevision)throw new ChatCsvError('Дані змінилися після preview. Перевірте CSV ще раз перед імпортом.',409);
  if(preview.conflicts.length)throw new ChatCsvError(preview.conflicts[0],409);
  const [accounts,existingRows]=await Promise.all([
    db.prepare(`SELECT id,account_number FROM telegram_accounts WHERE user_id=?1`).bind(input.userId).all<{id:string;account_number:number}>(),
    db.prepare(`SELECT normalized_link FROM chats WHERE user_id=?1 ORDER BY id LIMIT ${CHAT_CSV_MAX_ROWS+1}`).bind(input.userId).all<{normalized_link:string}>(),
  ]);
  const accountByNumber=new Map(accounts.results.map(row=>[Number(row.account_number),row.id]));
  const existing=new Set(existingRows.results.map(row=>row.normalized_link));
  const candidates=input.rows.filter(row=>!existing.has(row.normalizedLink));
  let inserted=0;
  for(let start=0;start<candidates.length;start+=100){
    const statements:D1PreparedStatement[]=[];
    const chatIndexes:number[]=[];
    for(const row of candidates.slice(start,start+100)){
      const id=crypto.randomUUID();
      const accountId=row.telegramAccountNumber===null?null:accountByNumber.get(row.telegramAccountNumber)||null;
      chatIndexes.push(statements.length);
      statements.push(db.prepare(`INSERT OR IGNORE INTO chats
        (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,archive_reason,archived_at,telegram_account_id,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`)
        .bind(id,input.userId,row.platform,row.name,row.link,row.normalizedLink,row.workflowStatus,Number(row.private),row.joinedAt,row.processedAt,row.snoozedUntil,row.archiveReason,row.archivedAt,accountId,row.createdAt,row.updatedAt));
      if(row.profile)statements.push(db.prepare(`INSERT OR IGNORE INTO chat_profiles
        (chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,'csv',?10 WHERE changes()=1`)
        .bind(id,row.profile.language,row.profile.cadence,JSON.stringify(row.profile.weekdays),row.profile.customIntervalDays,row.profile.nextAllowedOn,JSON.stringify(row.profile.directions),row.profile.note,row.profile.reviewStatus,row.updatedAt));
    }
    if(!statements.length)continue;
    const result=await db.batch(statements);
    inserted+=chatIndexes.reduce((sum,index)=>sum+(Number(result[index]?.meta.changes||0)>0?1:0),0);
  }
  return {ok:true,inserted,existing:input.rows.length-inserted,total:input.rows.length,preview:stripRows(preview)};
}

export function stripRows(preview:ChatCsvPreview){
  const {rows:_rows,...publicPreview}=preview;
  return publicPreview;
}

function exportRow(row:ExportRow):ChatCsvRow {
  const hasProfile=Boolean(row.profile_chat_id);
  return {
    work_os_chat_csv_version:CHAT_CSV_VERSION,platform:row.platform,name:safeSpreadsheetText(row.name),link:row.link,
    workflow_status:row.workflow_status,joined_at:numberCell(row.joined_at),processed_at:numberCell(row.processed_at),snoozed_until:numberCell(row.snoozed_until),
    archive_reason:safeSpreadsheetText(row.archive_reason||''),archived_at:numberCell(row.archived_at),created_at:String(row.created_at),updated_at:String(row.updated_at),
    telegram_account_number:numberCell(row.telegram_account_number),has_profile:hasProfile?'1':'0',profile_language:hasProfile?(row.profile_language||''):'',
    profile_cadence:hasProfile?(row.profile_cadence||'any'):'',profile_weekdays_json:hasProfile?(row.profile_weekdays_json||'[]'):'',
    profile_custom_interval_days:hasProfile?numberCell(row.profile_custom_interval_days):'',profile_next_allowed_on:hasProfile?(row.profile_next_allowed_on||''):'',
    profile_directions_json:hasProfile?(row.profile_directions_json||'[]'):'',profile_note:hasProfile?safeSpreadsheetText(row.profile_note||''):'',
    profile_review_status:hasProfile?(row.profile_review_status||'draft'):'',
  };
}
function parseProfile(raw:ChatCsvRow,rowNumber:number):NonNullable<ChatCsvImportRow['profile']>{
  const language=raw.profile_language===''?null:raw.profile_language;
  if(language!==null&&language!=='uk'&&language!=='ru')throw new ChatCsvError(`Рядок ${rowNumber}: некоректна мова профілю.`);
  if(!CADENCES.has(raw.profile_cadence))throw new ChatCsvError(`Рядок ${rowNumber}: некоректна частота профілю.`);
  const weekdays=jsonNumberList(raw.profile_weekdays_json,rowNumber,'дні профілю',7);
  if(weekdays.some(day=>day<1||day>7))throw new ChatCsvError(`Рядок ${rowNumber}: некоректні дні профілю.`);
  const directions=jsonStringList(raw.profile_directions_json,rowNumber,'напрямки профілю',12,80);
  const customIntervalDays=optionalPositiveInt(raw.profile_custom_interval_days,rowNumber,'власний інтервал');
  if(raw.profile_cadence==='custom'&&customIntervalDays===null)throw new ChatCsvError(`Рядок ${rowNumber}: для власної частоти потрібен інтервал.`);
  const nextAllowedOn=optionalDate(raw.profile_next_allowed_on,rowNumber);
  if(raw.profile_review_status!=='draft'&&raw.profile_review_status!=='confirmed')throw new ChatCsvError(`Рядок ${rowNumber}: некоректний статус профілю.`);
  return {language:language as 'uk'|'ru'|null,cadence:raw.profile_cadence as NonNullable<ChatCsvImportRow['profile']>['cadence'],weekdays,customIntervalDays,nextAllowedOn,directions,note:profileText(raw.profile_note,1000),reviewStatus:raw.profile_review_status};
}
function parseCsvRecords(text:string){
  const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=char;continue;}
    if(char==='"'){if(cell!=='')throw new ChatCsvError('Некоректні лапки у CSV.');quoted=true;continue;}
    if(char===','){row.push(cell);cell='';continue;}
    if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue;}
    cell+=char;
  }
  if(quoted)throw new ChatCsvError('CSV містить незакриті лапки.');
  if(cell!==''||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
function csvCell(value:string){const text=value??'';return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function safeSpreadsheetText(value:string){return /^[=+\-@]/.test(value)?`\t${value}`:value;}
function restoreSpreadsheetText(value:string){return /^\t[=+\-@]/.test(value)?value.slice(1):value;}
function numberCell(value:number|null|undefined){return value===null||value===undefined?'':String(value);}
function optionalEpoch(value:string,row:number,label:string){if(!value)return null;const n=Number(value);if(!Number.isInteger(n)||n<0)throw new ChatCsvError(`Рядок ${row}: некоректне ${label}.`);return n;}
function requiredEpoch(value:string,row:number,label:string){const n=optionalEpoch(value,row,label);if(n===null)throw new ChatCsvError(`Рядок ${row}: відсутнє ${label}.`);return n;}
function optionalPositiveInt(value:string,row:number,label:string){if(!value)return null;const n=Number(value);if(!Number.isInteger(n)||n<1)throw new ChatCsvError(`Рядок ${row}: некоректне ${label}.`);return n;}
function optionalText(value:string,max:number){const cleaned=value.replace(/\p{Cc}/gu,' ').trim().replace(/\s+/g,' ').normalize('NFC');return cleaned?Array.from(cleaned).slice(0,max).join(''):null;}
function profileText(value:string,max:number){const cleaned=value.replace(/\p{Cc}/gu,' ').trim().replace(/\s+/g,' ').normalize('NFC');return Array.from(cleaned).slice(0,max).join('');}
function optionalDate(value:string,row:number){if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ChatCsvError(`Рядок ${row}: некоректна дата профілю.`);const parsed=new Date(`${value}T12:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new ChatCsvError(`Рядок ${row}: некоректна дата профілю.`);return value;}
function jsonNumberList(value:string,row:number,label:string,max:number){let parsed:unknown;try{parsed=JSON.parse(value||'[]');}catch{throw new ChatCsvError(`Рядок ${row}: некоректні ${label}.`);}if(!Array.isArray(parsed)||parsed.length>max||parsed.some(item=>!Number.isInteger(item)))throw new ChatCsvError(`Рядок ${row}: некоректні ${label}.`);return [...new Set(parsed as number[])].sort((a,b)=>a-b);}
function jsonStringList(value:string,row:number,label:string,maxItems:number,maxLength:number){let parsed:unknown;try{parsed=JSON.parse(value||'[]');}catch{throw new ChatCsvError(`Рядок ${row}: некоректні ${label}.`);}if(!Array.isArray(parsed)||parsed.length>maxItems||parsed.some(item=>typeof item!=='string'||Array.from(item).length>maxLength))throw new ChatCsvError(`Рядок ${row}: некоректні ${label}.`);return [...new Set((parsed as string[]).map(item=>item.trim()).filter(Boolean))];}
function emptyPlatformSummary():ChatCsvPreview['byPlatform']{return {telegram:{total:0,add:0,existing:0},whatsapp:{total:0,add:0,existing:0},viber:{total:0,add:0,existing:0},facebook:{total:0,add:0,existing:0}};}
