import { cleanChatName } from './bulk-input.ts';
import { chatStateEvent, chatStateTokenSql } from './state.ts';

export const DUPLICATE_SCAN_LIMIT = 10_000;

export type DuplicateChat = {
  id:string; name:string; link:string; normalizedLink:string; platform:string;
  status:string; archiveReason:string|null; archivedAt:number|null;
  telegramAccountId:string|null; stateToken:string;
};
export type DuplicateGroup = {
  key:string; match:'link'|'name'; chats:DuplicateChat[];
};

type Row = {
  id:string; name:string; link:string; normalized_link:string; platform:string;
  workflow_status:string; archive_reason:string|null; archived_at:number|null;
  telegram_account_id:string|null; state_token:string;
};

export class ChatDuplicateError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.name='ChatDuplicateError';this.status=status;}
}

export async function readChatDuplicateGroups(db:D1Database,input:{
  userId:string; platform:string; accountId?:string|null;
}):Promise<DuplicateGroup[]> {
  const telegram=input.platform==='telegram';
  if(telegram&&!input.accountId) throw new ChatDuplicateError('Оберіть активний Telegram-акаунт.');
  const accountFilter=telegram
    ? ` AND (c.telegram_account_id=?3 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))`
    : '';
  const result=await db.prepare(`SELECT c.id,c.name,c.link,c.normalized_link,c.platform,c.workflow_status,
      c.archive_reason,c.archived_at,c.telegram_account_id,${chatStateTokenSql()} AS state_token
    FROM chats c WHERE c.user_id=?1 AND c.platform=?2${accountFilter}
    ORDER BY c.updated_at DESC,c.id LIMIT ${DUPLICATE_SCAN_LIMIT+1}`)
    .bind(input.userId,input.platform,...(telegram?[input.accountId]:[])).all<Row>();
  if(result.results.length>DUPLICATE_SCAN_LIMIT) {
    throw new ChatDuplicateError(`Менеджер дублікатів підтримує до ${DUPLICATE_SCAN_LIMIT} чатів на платформу.`,409);
  }
  return duplicateGroups(result.results.map(view));
}

export function duplicateGroups(chats:DuplicateChat[]):DuplicateGroup[] {
  const parent=new Map<string,string>();
  const find=(id:string):string=>{
    const p=parent.get(id)??id;
    if(p===id){parent.set(id,id);return id;}
    const root=find(p);parent.set(id,root);return root;
  };
  const union=(a:string,b:string)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);};
  const links=new Map<string,string>();
  const names=new Map<string,string>();
  for(const chat of chats){
    parent.set(chat.id,chat.id);
    const link=chat.normalizedLink.trim();
    if(link){const prior=links.get(link);if(prior)union(prior,chat.id);else links.set(link,chat.id);}
    const name=normalizeDuplicateName(chat.name);
    if(name){const prior=names.get(name);if(prior)union(prior,chat.id);else names.set(name,chat.id);}
  }
  const buckets=new Map<string,DuplicateChat[]>();
  for(const chat of chats){const root=find(chat.id);const bucket=buckets.get(root)??[];bucket.push(chat);buckets.set(root,bucket);}
  const groups:DuplicateGroup[]=[];
  for(const bucket of buckets.values()){
    if(bucket.length<2)continue;
    const seenLinks=new Set<string>();let linkMatch=false;
    for(const chat of bucket){if(seenLinks.has(chat.normalizedLink))linkMatch=true;seenLinks.add(chat.normalizedLink);}
    bucket.sort((a,b)=>statusRank(a.status)-statusRank(b.status)||a.name.localeCompare(b.name,'uk'));
    groups.push({key:bucket.map(chat=>chat.id).sort().join(':'),match:linkMatch?'link':'name',chats:bucket});
  }
  return groups.sort((a,b)=>(a.match==='link'?0:1)-(b.match==='link'?0:1)||a.chats[0].name.localeCompare(b.chats[0].name,'uk'));
}

export async function renameDuplicateChat(db:D1Database,input:{
  userId:string; id:string; stateToken:string; name:string; now:number;
}):Promise<{stateToken:string}> {
  const name=cleanChatName(input.name);
  if(!name) throw new ChatDuplicateError('Назва чату не може бути порожньою.');
  const row=await db.prepare(`SELECT c.name,${chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1 AND c.user_id=?2`)
    .bind(input.id,input.userId).first<{name:string;state_token:string}>();
  if(!row) throw new ChatDuplicateError('Чат не знайдено.',404);
  if(row.state_token!==input.stateToken) throw new ChatDuplicateError('Стан чату вже змінився. Оновіть список.',409);
  if(row.name===name) return {stateToken:row.state_token};
  const eventId=crypto.randomUUID();
  const results=await db.batch([
    db.prepare(`UPDATE chats SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 AND ${chatStateTokenSql('chats')}=?5`)
      .bind(name,input.now,input.id,input.userId,input.stateToken),
    chatStateEvent(db,{id:eventId,userId:input.userId,chatId:input.id,action:'rename',now:input.now,previous:input.stateToken}),
  ]);
  if(!results[0].meta.changes) throw new ChatDuplicateError('Стан чату вже змінився. Оновіть список.',409);
  const next=await db.prepare(`SELECT ${chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1 AND c.user_id=?2`)
    .bind(input.id,input.userId).first<{state_token:string}>();
  if(!next) throw new ChatDuplicateError('Не вдалося підтвердити нову назву.',409);
  return {stateToken:next.state_token};
}

function view(row:Row):DuplicateChat {
  return {id:row.id,name:row.name,link:row.link,normalizedLink:row.normalized_link,platform:row.platform,
    status:row.workflow_status,archiveReason:row.archive_reason,archivedAt:row.archived_at,
    telegramAccountId:row.telegram_account_id,stateToken:row.state_token};
}
function normalizeDuplicateName(value:string){return cleanChatName(value).normalize('NFKC').toLocaleLowerCase('uk-UA');}
function statusRank(status:string){return status==='archived'?1:0;}
