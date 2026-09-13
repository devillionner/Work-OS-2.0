import { businessDate } from '../business-time.ts';
import { chatStateTokenSql } from './state.ts';

export type ChatLeaveState = {
  required: boolean;
  confirmed: boolean;
  confirmedAt: number | null;
};

type LeaveRow = {
  platform: string;
  workflow_status: string;
  joined_at: number | null;
  event_type: string | null;
  occurred_at: number | null;
};

export async function readChatLeaveState(db: D1Database, userId: string, chatId: string): Promise<ChatLeaveState | null> {
  const row = await db.prepare(`SELECT c.platform,c.workflow_status,c.joined_at,
      (SELECT e.event_type FROM activity_events e WHERE e.user_id=c.user_id AND e.chat_id=c.id
        AND e.event_type IN ('chat_leave_confirmed','chat_leave_undone') ORDER BY e.rowid DESC LIMIT 1) AS event_type,
      (SELECT e.occurred_at FROM activity_events e WHERE e.user_id=c.user_id AND e.chat_id=c.id
        AND e.event_type IN ('chat_leave_confirmed','chat_leave_undone') ORDER BY e.rowid DESC LIMIT 1) AS occurred_at
    FROM chats c WHERE c.id=?1 AND c.user_id=?2 LIMIT 1`).bind(chatId,userId).first<LeaveRow>();
  if (!row) return null;
  const required = row.workflow_status === 'archived' && row.joined_at !== null && ['telegram','whatsapp'].includes(row.platform);
  return {
    required,
    confirmed: required && row.event_type === 'chat_leave_confirmed',
    confirmedAt: required && row.event_type === 'chat_leave_confirmed' ? row.occurred_at : null,
  };
}

export async function changeChatLeaveConfirmation(db: D1Database, input: {
  userId: string;
  chatId: string;
  stateToken: string;
  confirm: boolean;
  now: number;
}): Promise<{ ok: boolean; error?: string }> {
  const eventId = crypto.randomUUID();
  const eventType = input.confirm ? 'chat_leave_confirmed' : 'chat_leave_undone';
  const previousExpected = input.confirm ? "COALESCE((SELECT e.event_type FROM activity_events e WHERE e.user_id=c.user_id AND e.chat_id=c.id AND e.event_type IN ('chat_leave_confirmed','chat_leave_undone') ORDER BY e.rowid DESC LIMIT 1),'')!='chat_leave_confirmed'"
    : "(SELECT e.event_type FROM activity_events e WHERE e.user_id=c.user_id AND e.chat_id=c.id AND e.event_type IN ('chat_leave_confirmed','chat_leave_undone') ORDER BY e.rowid DESC LIMIT 1)='chat_leave_confirmed'";
  const result = await db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
    SELECT ?1,c.user_id,?2,c.platform,c.id,?3,?4,'{}',?5,c.telegram_account_id
    FROM chats c
    WHERE c.id=?6 AND c.user_id=?7 AND c.workflow_status='archived' AND c.joined_at IS NOT NULL
      AND c.platform IN ('telegram','whatsapp') AND ${chatStateTokenSql()}=?8 AND ${previousExpected}`)
    .bind(eventId,eventType,input.now,businessDate(input.now),`chat-leave:${eventId}`,input.chatId,input.userId,input.stateToken)
    .run();
  return result.meta.changes
    ? { ok: true }
    : { ok: false, error: 'Стан чату або чекліста вже змінився. Оновіть архів.' };
}

export function archivedChatNeedsLeave(input: { platform: string; joinedAt: number | null; leaveConfirmed: boolean }): boolean {
  return ['telegram','whatsapp'].includes(input.platform) && input.joinedAt !== null && !input.leaveConfirmed;
}
