import { businessDate } from '../business-time.ts';
import { chatStateTokenSql, type ChatState } from './state.ts';

const REQUIRED_REASON = 'Чат не існує';

export async function permanentlyDeleteChat(db:D1Database,input:{
  userId:string; chat:ChatState; now:number;
}):Promise<{ok:boolean;error?:string}> {
  const {chat}=input;
  if(chat.workflow_status!=='archived'||chat.archive_reason!==REQUIRED_REASON) {
    return {ok:false,error:'Остаточно видалити можна лише архівний чат із причиною «Чат не існує».'};
  }
  if(['telegram','whatsapp'].includes(chat.platform)&&chat.joined_at!==null&&chat.left_at===null) {
    return {ok:false,error:'Спочатку вручну вийдіть із чату та підтвердьте вихід.'};
  }

  const dependencies=await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM chat_publications WHERE user_id=?1 AND chat_id=?2) publications,
    EXISTS(SELECT 1 FROM leads WHERE user_id=?1 AND source_chat_id=?2) leads,
    EXISTS(SELECT 1 FROM telegram_schedule_slots WHERE user_id=?1 AND chat_id=?2 AND status='pending') pending_slots`)
    .bind(input.userId,chat.id).first<{publications:number;leads:number;pending_slots:number}>();
  if(dependencies?.publications) return {ok:false,error:'Чат має історію публікацій, тому його tombstone потрібно зберегти.'};
  if(dependencies?.leads) return {ok:false,error:'Чат є джерелом ліда, тому його tombstone потрібно зберегти.'};
  if(dependencies?.pending_slots) return {ok:false,error:'Спочатку приберіть чат із запланованих Telegram-публікацій.'};

  const eventId=crypto.randomUUID();
  const metadata=JSON.stringify({
    action:'permanent_delete',deletedChatId:chat.id,name:chat.name,link:chat.link,
    archiveReason:chat.archive_reason,archivedAt:chat.archived_at,previousState:JSON.parse(chat.state_token),
  });
  const results=await db.batch([
    db.prepare(`DELETE FROM chats WHERE id=?1 AND user_id=?2 AND workflow_status='archived'
      AND archive_reason=?3 AND ${chatStateTokenSql('chats')}=?4
      AND NOT EXISTS(SELECT 1 FROM chat_publications p WHERE p.user_id=?2 AND p.chat_id=chats.id)
      AND NOT EXISTS(SELECT 1 FROM leads l WHERE l.user_id=?2 AND l.source_chat_id=chats.id)
      AND NOT EXISTS(SELECT 1 FROM telegram_schedule_slots s WHERE s.user_id=?2 AND s.chat_id=chats.id AND s.status='pending')`)
      .bind(chat.id,input.userId,REQUIRED_REASON,chat.state_token),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
      SELECT ?1,?2,'chat_permanently_deleted',?3,NULL,?4,?5,?6,?7 WHERE changes()=1`)
      .bind(eventId,input.userId,chat.platform,input.now,businessDate(input.now),metadata,`chat-permanent-delete:${eventId}`),
  ]);
  return results[0].meta.changes
    ? {ok:true}
    : {ok:false,error:'Чат або пов’язані дані вже змінилися. Оновіть список.'};
}
