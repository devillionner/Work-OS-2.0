import { businessDate } from '../business-time.ts';

export type ChatState = {
  id: string; platform: string; workflow_status: string; joined_at: number | null;
  snoozed_until: number | null; telegram_account_id: string | null; state_token: string;
};

// The latest transition ID distinguishes archive/restore cycles within one second.
// The existing (chat_id,event_type) index also orders matching entries by rowid.
export function chatStateTokenSql(alias: 'c' | 'chats' = 'c') {
  return `json_array(${alias}.platform,${alias}.workflow_status,${alias}.joined_at,
    ${alias}.processed_at,${alias}.snoozed_until,${alias}.archive_reason,
    ${alias}.archived_at,${alias}.telegram_account_id,${alias}.updated_at,
    (SELECT e.id FROM activity_events e WHERE e.chat_id=${alias}.id
      AND e.user_id=${alias}.user_id AND e.event_type='chat_state_changed'
      ORDER BY e.rowid DESC LIMIT 1),
    (SELECT p.id FROM activity_events p WHERE p.chat_id=${alias}.id
      AND p.user_id=${alias}.user_id AND p.event_type='publication'
      ORDER BY p.rowid DESC LIMIT 1))`;
}

export function readChatState(db: D1Database, userId: string, id: string) {
  return db.prepare(`SELECT c.id,c.platform,c.workflow_status,c.joined_at,
    c.snoozed_until,c.telegram_account_id,${chatStateTokenSql()} AS state_token
    FROM chats c WHERE c.id=?1 AND c.user_id=?2`).bind(id,userId).first<ChatState>();
}

// Must immediately follow the guarded UPDATE in the same D1 batch. SQLite
// changes() excludes backup-revision triggers; no successful UPDATE means no event.
export function chatStateEvent(db: D1Database, input: {
  id: string; userId: string; chatId: string; action: string; now: number; previous: string;
}) {
  return db.prepare(`INSERT INTO activity_events
    (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
    SELECT ?1,c.user_id,'chat_state_changed',c.platform,c.id,?2,?3,
      json_object('action',?4,'previousState',json(?5),'state',json(${chatStateTokenSql()})),?6,c.telegram_account_id
    FROM chats c WHERE c.id=?7 AND c.user_id=?8 AND changes()=1`)
    .bind(input.id,input.now,businessDate(input.now),input.action,input.previous,
      `chat-state:${input.id}`,input.chatId,input.userId);
}
