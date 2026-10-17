import { businessDate } from '../business-time.ts';

export type ChatState = {
  id: string; name: string; link: string; platform: string; workflow_status: string; joined_at: number | null;
  archive_reason: string | null; archived_at: number | null;
  snoozed_until: number | null; telegram_account_id: string | null; left_at: number | null; state_token: string;
};

// Підсумок подій по чату (chat_event_summary, міграція 0048) веде тригер на activity_events: рядок списку читає одну
// первинну пару замість обходу всієї історії подій чату. Значення ті самі, що давали колишні підзапити за rowid DESC.
export function chatLeftAtSql(alias: 'c' | 'chats' = 'c') {
  return `(SELECT s.left_at FROM chat_event_summary s WHERE s.chat_id=${alias}.id)`;
}

// The latest transition ID distinguishes archive/restore cycles within one second.
export function chatStateTokenSql(alias: 'c' | 'chats' = 'c') {
  return `json_array(${alias}.platform,${alias}.workflow_status,${alias}.joined_at,
    ${alias}.processed_at,${alias}.snoozed_until,${alias}.archive_reason,
    ${alias}.archived_at,${alias}.telegram_account_id,${alias}.updated_at,
    (SELECT p.updated_at FROM chat_profiles p WHERE p.chat_id=${alias}.id),
    (SELECT s.last_state_event_id FROM chat_event_summary s WHERE s.chat_id=${alias}.id),
    (SELECT s.last_publication_event_id FROM chat_event_summary s WHERE s.chat_id=${alias}.id))`;
}

/**
 * Той самий токен для запиту, де профіль і підсумок чату вже приєднані (`LEFT JOIN chat_profiles p`, `LEFT JOIN
 * chat_event_summary s`): значення збігається з chatStateTokenSql, а читань на рядок немає.
 */
export function chatJoinedStateTokenSql(chat = 'c', profile = 'p', summary = 's') {
  return `json_array(${chat}.platform,${chat}.workflow_status,${chat}.joined_at,
    ${chat}.processed_at,${chat}.snoozed_until,${chat}.archive_reason,
    ${chat}.archived_at,${chat}.telegram_account_id,${chat}.updated_at,
    ${profile}.updated_at,${summary}.last_state_event_id,${summary}.last_publication_event_id)`;
}

export function readChatState(db: D1Database, userId: string, id: string) {
  return db.prepare(`SELECT c.id,c.name,c.link,c.platform,c.workflow_status,c.joined_at,
    c.archive_reason,c.archived_at,c.snoozed_until,c.telegram_account_id,${chatLeftAtSql()} AS left_at,${chatStateTokenSql()} AS state_token
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
