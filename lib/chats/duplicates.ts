import { businessDate } from '../business-time.ts';
import { cleanChatName, normalizeGroupLink } from './bulk-input.ts';
import { chatStateEvent, chatStateTokenSql } from './state.ts';

export const DUPLICATE_SWEEP_CHUNK = 500;
const SWEEP_MAX_CHUNKS = 4;

export type DuplicateChat = {
  id:string; name:string; link:string; normalizedLink:string; platform:string;
  status:string; archiveReason:string|null; archivedAt:number|null;
  telegramAccountId:string|null; accountName?:string|null; stateToken:string;
};
export type DuplicateGroup = {
  key:string; match:'link'|'name'; chats:DuplicateChat[];
  /** Основний чат: той, що далі по роботі (опублікований чи приєднаний важливіший за «для приєднання», потім давніший). */
  keepId:string;
  /** Публікацій по чатах групи. */
  publications:Record<string,number>;
  /** Доби, у яких публікація є одразу в кількох чатах групи: після злиття лишиться одна (унікальний ключ чат+доба). */
  collisionDays:number;
};

type Row = {
  id:string; name:string; link:string; normalized_link:string; platform:string;
  workflow_status:string; archive_reason:string|null; archived_at:number|null;
  telegram_account_id:string|null; account_name:string|null; created_at:number; state_token:string;
};

export class ChatDuplicateError extends Error {
  status:number; code:string;
  constructor(message:string,status=400,code=''){super(message);this.name='ChatDuplicateError';this.status=status;this.code=code;}
}

/**
 * Канонічний ключ посилання: те, за чим чат упізнається, хоч би як його вставили (великі літери в username, параметри `?mode=…`,
 * посилання на повідомлення `t.me/name/123`). Той самий чат у будь-якого акаунта дає той самий ключ.
 */
export function duplicateLinkKey(platform:string,link:string,normalizedLink=''):string|null {
  for(const value of [link,normalizedLink]) {
    const parsed=value?normalizeGroupLink(value):null;
    if(parsed&&parsed.platform===platform) return parsed.link;
  }
  if(platform==='telegram') {
    for(const value of [link,normalizedLink]) {
      const match=/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?!\+|joinchat)([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#].*)?$/i.exec(String(value||'').trim());
      if(match) return `https://t.me/${match[1].toLowerCase()}`;
    }
  }
  return null;
}
export function duplicateNameKey(name:string):string {
  return name.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('uk-UA');
}

type SweepRow = {id:string; platform:string; name:string; link:string; normalized_link:string};

/**
 * Розбирає чергу chat_dup_pending: перераховує ключі змінених чатів, виправляє застарілі `normalized_link` на канонічні (тоді унікальний
 * індекс (user_id,platform,normalized_link) сам не пускає повторне додавання того самого чату з будь-якого місця) і ставить позначки
 * chat_dup_flags тим, у кого є пара за ключем. Читає й пише лише змінене. true — черга ще не порожня.
 */
export async function sweepChatDuplicateIndex(db:D1Database,userId:string,chunks=SWEEP_MAX_CHUNKS):Promise<boolean> {
  for(let round=0;round<chunks;round+=1) {
    const pending=await db.prepare(`SELECT c.id,c.platform,c.name,c.link,c.normalized_link
      FROM chat_dup_pending p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 LIMIT ?2`)
      .bind(userId,DUPLICATE_SWEEP_CHUNK).all<SweepRow>();
    const rows=pending.results;
    if(!rows.length) return false;
    const ids=rows.map(row=>row.id);
    const keys:Array<{kind:string;key:string;chat:string}>=[];
    const canon=new Map<string,string[]>();
    for(const row of rows) {
      const link=duplicateLinkKey(row.platform,row.link,row.normalized_link);
      if(link) {
        keys.push({kind:'link',key:`${row.platform}|${link}`,chat:row.id});
        if(link!==row.normalized_link) canon.set(link,[...(canon.get(link)||[]),row.id]);
      }
      const name=duplicateNameKey(row.name);
      if(name) keys.push({kind:'name',key:`${row.platform}|${name}`,chat:row.id});
    }
    await db.batch([
      db.prepare(`DELETE FROM chat_dup_keys WHERE chat_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)),
      db.prepare(`INSERT OR REPLACE INTO chat_dup_keys(user_id,kind,key,chat_id)
        SELECT ?1,json_extract(v.value,'$.kind'),json_extract(v.value,'$.key'),json_extract(v.value,'$.chat') FROM json_each(?2) v`)
        .bind(userId,JSON.stringify(keys)),
    ]);
    // Один одразу кілька чатів із тим самим канонічним посиланням — це дублікати, їх зливає менеджер, а не цей прохід.
    const updates=[...canon.entries()].filter(([,owners])=>owners.length===1).map(([link,owners])=>({id:owners[0],canon:link}));
    if(updates.length) {
      try {
        await db.prepare(`UPDATE chats SET normalized_link=u.canon
          FROM (SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.canon') AS canon FROM json_each(?1)) u
          WHERE chats.id=u.id AND chats.user_id=?2 AND NOT EXISTS(
            SELECT 1 FROM chats o WHERE o.user_id=chats.user_id AND o.platform=chats.platform AND o.normalized_link=u.canon)`)
          .bind(JSON.stringify(updates),userId).run();
      } catch(error) { console.error('chat duplicate canonical link update failed',error); }
    }
    const pairs=await db.prepare(`SELECT k1.chat_id AS a,k2.chat_id AS b FROM json_each(?2) j
      CROSS JOIN chat_dup_keys k1 INDEXED BY chat_dup_keys_chat_idx ON k1.chat_id=j.value
      CROSS JOIN chat_dup_keys k2 ON k2.user_id=k1.user_id AND k2.kind=k1.kind AND k2.key=k1.key AND k2.chat_id<>k1.chat_id
      WHERE k1.user_id=?1`).bind(userId,JSON.stringify(ids)).all<{a:string;b:string}>();
    const flagged=new Set<string>();
    for(const pair of pairs.results) { flagged.add(pair.a); flagged.add(pair.b); }
    await db.batch([
      db.prepare(`DELETE FROM chat_dup_flags WHERE chat_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)),
      db.prepare(`INSERT OR IGNORE INTO chat_dup_flags(chat_id,user_id) SELECT value,?2 FROM json_each(?1)`).bind(JSON.stringify([...flagged]),userId),
      db.prepare(`DELETE FROM chat_dup_pending WHERE chat_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)),
    ]);
    if(rows.length<DUPLICATE_SWEEP_CHUNK) return false;
  }
  return true;
}

/** Доводить індекс до кінця (перший раз після міграції це всі чати порціями); потім виклик майже нічого не читає. */
export async function ensureChatDuplicateIndex(db:D1Database,userId:string):Promise<void> {
  for(let attempt=0;attempt<12;attempt+=1) if(!await sweepChatDuplicateIndex(db,userId)) return;
}

export async function readChatDuplicateGroups(db:D1Database,input:{
  userId:string; platform?:string|null;
}):Promise<{groups:DuplicateGroup[];indexing:boolean}> {
  const indexing=await sweepChatDuplicateIndex(db,input.userId);
  if(indexing) return {groups:[],indexing:true};
  const result=await db.prepare(`SELECT c.id,c.name,c.link,c.normalized_link,c.platform,c.workflow_status,
      c.archive_reason,c.archived_at,c.telegram_account_id,t.name AS account_name,c.created_at,${chatStateTokenSql()} AS state_token
    FROM chat_dup_flags f JOIN chats c ON c.id=f.chat_id LEFT JOIN telegram_accounts t ON t.id=c.telegram_account_id
    WHERE f.user_id=?1 AND (?2 IS NULL OR c.platform=?2) ORDER BY c.platform,c.id`)
    .bind(input.userId,input.platform||null).all<Row>();
  const chats=result.results.map(view);
  const grouped=duplicateGroupsBase(chats);
  const inGroup=new Set(grouped.flatMap(group=>group.chats.map(chat=>chat.id)));
  const stale=chats.filter(chat=>!inGroup.has(chat.id)).map(chat=>chat.id);
  if(stale.length) await db.prepare(`DELETE FROM chat_dup_flags WHERE chat_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(stale)).run();
  if(!grouped.length) return {groups:[],indexing:false};
  const ids=grouped.flatMap(group=>group.chats.map(chat=>chat.id));
  const pubs=await db.prepare(`SELECT chat_id,published_on FROM chat_publications WHERE user_id=?1 AND chat_id IN (SELECT value FROM json_each(?2))`)
    .bind(input.userId,JSON.stringify(ids)).all<{chat_id:string;published_on:string}>();
  const byChat=new Map<string,string[]>();
  for(const row of pubs.results) byChat.set(row.chat_id,[...(byChat.get(row.chat_id)||[]),row.published_on]);
  const created=new Map(result.results.map(row=>[row.id,row.created_at]));
  const groups=grouped.map((group):DuplicateGroup=>{
    const publications=Object.fromEntries(group.chats.map(chat=>[chat.id,(byChat.get(chat.id)||[]).length]));
    const days=new Map<string,number>();
    for(const chat of group.chats) for(const day of new Set(byChat.get(chat.id)||[])) days.set(day,(days.get(day)||0)+1);
    // Архів із справжньою причиною (нецільовий, забанено, чат не існує) лишається основним, щоб блокування не загубилось;
    // архів «Дублікат» від старого менеджера — найнижчий пріоритет.
    const blocked=(chat:DuplicateChat)=>chat.status==='archived'&&Boolean(chat.archiveReason)&&chat.archiveReason!=='Дублікат';
    const rank=(chat:DuplicateChat)=>[blocked(chat)?0:1,publications[chat.id]>0?0:1,chat.status==='archived'&&!blocked(chat)?5:mainStatusRank(chat.status),created.get(chat.id)??0] as const;
    const keep=[...group.chats].sort((a,b)=>{const x=rank(a),y=rank(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]||x[3]-y[3]||a.id.localeCompare(b.id);})[0];
    return {...group,keepId:keep.id,publications,collisionDays:[...days.values()].filter(count=>count>1).length};
  });
  return {groups,indexing:false};
}

function mainStatusRank(status:string){return ({ready:0,waiting:1,failed:2,to_join:3,archived:4} as Record<string,number>)[status]??5;}

function duplicateGroupsBase(chats:DuplicateChat[]):Array<{key:string;match:'link'|'name';chats:DuplicateChat[]}> {
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
  const groups:Array<{key:string;match:'link'|'name';chats:DuplicateChat[]}>=[];
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
  return {id:row.id,name:row.name,link:row.link,normalizedLink:duplicateLinkKey(row.platform,row.link,row.normalized_link)??row.normalized_link,platform:row.platform,
    status:row.workflow_status,archiveReason:row.archive_reason,archivedAt:row.archived_at,
    telegramAccountId:row.telegram_account_id,accountName:row.account_name,stateToken:row.state_token};
}
function normalizeDuplicateName(value:string){return cleanChatName(value).normalize('NFKC').toLocaleLowerCase('uk-UA');}
function statusRank(status:string){return status==='archived'?1:0;}

export type MergeResult = {
  merged:number; movedPublications:number; lostPublications:number;
  /** Публікації по добах до й після злиття: однакові, окрім втрачених через збіг дати. */
  daysBefore:Record<string,number>; daysAfter:Record<string,number>;
};

/**
 * Дублікат видаляється назавжди, а не йде в архів: уся історія копії спершу переходить на основний чат (публікації, події, задачі
 * автопосту, слоти розкладу, джерело лідів, кандидати автопошуку, профіль, якщо в основного його немає), потім копію видаляють.
 * Усе одним batch. Публікація за добу, у якій основний чат уже має свою, не може лишитись у тому ж чаті (унікальний ключ чат+доба),
 * тому такі збіги вимагають `acceptLoss`; без нього злиття відмовляє й нічого не змінює.
 */
export async function mergeDuplicateChats(db:D1Database,input:{
  userId:string; keepId:string; removeIds:string[]; acceptLoss?:boolean; now:number;
}):Promise<MergeResult> {
  const removeIds=[...new Set(input.removeIds)].filter(id=>id&&id!==input.keepId);
  if(!input.keepId||!removeIds.length) throw new ChatDuplicateError('Оберіть основний чат і дублікати.');
  if(removeIds.length>20) throw new ChatDuplicateError('За раз можна злити до 20 копій.');
  const ids=[input.keepId,...removeIds];
  const found=await db.prepare(`SELECT c.id,c.name,c.link,c.normalized_link,c.platform,c.workflow_status FROM chats c
    WHERE c.user_id=?1 AND c.id IN (SELECT value FROM json_each(?2))`).bind(input.userId,JSON.stringify(ids)).all<{id:string;name:string;link:string;normalized_link:string;platform:string;workflow_status:string}>();
  if(found.results.length!==ids.length) throw new ChatDuplicateError('Чат уже змінено або видалено. Оновіть список.',409);
  const keep=found.results.find(row=>row.id===input.keepId)!;
  if(found.results.some(row=>row.platform!==keep.platform)) throw new ChatDuplicateError('Чати з різних платформ зливати не можна.');
  // Кожна копія має збігатися з основним чатом за ключем (посиланням чи назвою): довільне видалення чужого чату неможливе.
  const linked=await db.prepare(`SELECT DISTINCT b.chat_id AS id FROM chat_dup_keys a
    JOIN chat_dup_keys b ON b.user_id=a.user_id AND b.kind=a.kind AND b.key=a.key AND b.chat_id<>a.chat_id
    WHERE a.user_id=?1 AND a.chat_id=?2 AND b.chat_id IN (SELECT value FROM json_each(?3))`)
    .bind(input.userId,input.keepId,JSON.stringify(removeIds)).all<{id:string}>();
  if(linked.results.length!==removeIds.length) throw new ChatDuplicateError('Ці чати не збігаються за посиланням чи назвою. Оновіть список.',409);
  const pubs=await db.prepare(`SELECT chat_id,published_on FROM chat_publications WHERE user_id=?1 AND chat_id IN (SELECT value FROM json_each(?2))`)
    .bind(input.userId,JSON.stringify(ids)).all<{chat_id:string;published_on:string}>();
  const daysBefore:Record<string,number>={};
  const taken=new Set<string>();
  for(const row of pubs.results) { daysBefore[row.published_on]=(daysBefore[row.published_on]||0)+1; if(row.chat_id===input.keepId) taken.add(row.published_on); }
  let lost=0;let moved=0;
  for(const id of removeIds) for(const row of pubs.results.filter(item=>item.chat_id===id)) {
    if(taken.has(row.published_on)) lost+=1; else { taken.add(row.published_on); moved+=1; }
  }
  if(lost&&!input.acceptLoss) throw new ChatDuplicateError(`У ${lost} добах публікація є одразу в основному чаті й копії: після злиття лишиться одна на добу.`,409,'publication_collision');

  const canonical=duplicateLinkKey(keep.platform,keep.link,keep.normalized_link);
  const statements:D1PreparedStatement[]=[];
  const q=(sql:string,...values:unknown[])=>statements.push(db.prepare(sql).bind(...values));
  for(const rm of removeIds) {
    // Активні задачі автопосту копії скасовуємо (в основного чату може бути своя активна: ключ active_key унікальний), історію переносимо.
    q(`UPDATE whatsapp_autopost_jobs SET status='cancelled',active_key=NULL,updated_at=?3 WHERE user_id=?1 AND chat_id=?2 AND status IN ('pending','claimed')`,input.userId,rm,input.now);
    q(`UPDATE whatsapp_autopost_jobs SET chat_id=?3 WHERE user_id=?1 AND chat_id=?2`,input.userId,rm,input.keepId);
    q(`UPDATE chat_publications SET chat_id=?3 WHERE user_id=?1 AND chat_id=?2
      AND published_on NOT IN (SELECT published_on FROM chat_publications WHERE user_id=?1 AND chat_id=?3)`,input.userId,rm,input.keepId);
    q(`UPDATE activity_events SET chat_id=?3 WHERE user_id=?1 AND chat_id=?2`,input.userId,rm,input.keepId);
    // Очікуючий слот копії: якщо в основного такий уже є — слот звільняється (chat_id NULL), інакше переходить.
    q(`UPDATE telegram_schedule_slots SET chat_id=NULL WHERE user_id=?1 AND chat_id=?2 AND status='pending'
      AND EXISTS(SELECT 1 FROM telegram_schedule_slots k WHERE k.user_id=?1 AND k.chat_id=?3 AND k.status='pending' AND k.telegram_account_id=telegram_schedule_slots.telegram_account_id)`,input.userId,rm,input.keepId);
    q(`UPDATE telegram_schedule_slots SET chat_id=?3 WHERE user_id=?1 AND chat_id=?2`,input.userId,rm,input.keepId);
    q(`UPDATE leads SET source_chat_id=?3 WHERE user_id=?1 AND source_chat_id=?2`,input.userId,rm,input.keepId);
    q(`UPDATE chat_discovery_candidates SET imported_chat_id=?3 WHERE user_id=?1 AND imported_chat_id=?2`,input.userId,rm,input.keepId);
    q(`UPDATE chat_profiles SET chat_id=?3 WHERE chat_id=?2 AND ?1<>'' AND NOT EXISTS(SELECT 1 FROM chat_profiles WHERE chat_id=?3)`,input.userId,rm,input.keepId);
    q(`UPDATE telegram_schedule_settings SET manual_chat_ids_json=REPLACE(manual_chat_ids_json,'"'||?2||'"','"'||?3||'"') WHERE user_id=?1 AND manual_chat_ids_json LIKE '%'||?2||'%'`,input.userId,rm,input.keepId);
  }
  // Підсумок для списку чатів перераховується з перенесених подій (тригери рахують лише нові).
  q(`INSERT OR REPLACE INTO chat_event_summary(chat_id,user_id,snooze_count,left_at,last_state_event_id,last_publication_event_id)
    SELECT ?2,?1,
      COALESCE((SELECT COUNT(*) FROM activity_events WHERE chat_id=?2 AND event_type='chat_state_changed' AND json_extract(metadata_json,'$.action')='snooze'),0),
      (SELECT le.occurred_at FROM activity_events le WHERE le.chat_id=?2 AND le.event_type='chat_state_changed'
        AND json_extract(le.metadata_json,'$.action') IN ('confirm_leave','undo_leave','joined','approved') ORDER BY le.rowid DESC LIMIT 1),
      (SELECT e.id FROM activity_events e WHERE e.chat_id=?2 AND e.event_type='chat_state_changed' ORDER BY e.rowid DESC LIMIT 1),
      (SELECT p.id FROM activity_events p WHERE p.chat_id=?2 AND p.event_type='publication' ORDER BY p.rowid DESC LIMIT 1)`,input.userId,input.keepId);
  q(`DELETE FROM chats WHERE user_id=?1 AND id IN (SELECT value FROM json_each(?2))`,input.userId,JSON.stringify(removeIds));
  if(canonical&&canonical!==keep.normalized_link) {
    q(`UPDATE chats SET normalized_link=?3,updated_at=?4 WHERE id=?2 AND user_id=?1 AND NOT EXISTS(
      SELECT 1 FROM chats o WHERE o.user_id=?1 AND o.platform=chats.platform AND o.normalized_link=?3 AND o.id<>?2)`,input.userId,input.keepId,canonical,input.now);
  }
  const removed=found.results.filter(row=>row.id!==input.keepId);
  const eventId=crypto.randomUUID();
  q(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
    VALUES(?1,?2,'chat_permanently_deleted',?3,?4,?5,?6,?7,?8)`,eventId,input.userId,keep.platform,input.keepId,input.now,businessDate(input.now),
    JSON.stringify({action:'duplicate_merge',keepId:input.keepId,keepName:keep.name,removed:removed.map(row=>({id:row.id,name:row.name,link:row.link,status:row.workflow_status})),movedPublications:moved,lostPublications:lost}),
    `chat-duplicate-merge:${eventId}`);
  await db.batch(statements);
  const after=await db.prepare(`SELECT published_on,COUNT(*) AS n FROM chat_publications WHERE user_id=?1 AND chat_id=?2 GROUP BY published_on`)
    .bind(input.userId,input.keepId).all<{published_on:string;n:number}>();
  return {merged:removeIds.length,movedPublications:moved,lostPublications:lost,daysBefore,daysAfter:Object.fromEntries(after.results.map(row=>[row.published_on,row.n]))};
}
