import { businessDate } from '../business-time.ts';
import { discoveryMembershipForTransition, discoveryMembershipStatement } from '../chat-discovery/workflow-link.ts';
import { chatStateEvent, chatStateTokenSql, type ChatState } from './state.ts';

const ALLOWED_FROM: Record<string, readonly string[]> = {
  joined: ['to_join'], waiting: ['to_join'], failed: ['to_join'], approved: ['waiting'],
  archive: ['to_join','waiting','ready'], restore: ['archived'], return_to_join: ['ready'],
  assign_account: ['waiting','ready','archived'],
};

export async function transitionChat(db: D1Database, input: {
  userId: string; chat: ChatState; action: string; accountId: string | null; now: number; reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { userId, chat, action, now } = input;
  if (!ALLOWED_FROM[action]?.includes(chat.workflow_status)) return {ok:false,error:'Стан чату вже змінився. Оновіть список.'};
  if (action === 'waiting' && !['telegram','whatsapp'].includes(chat.platform)) return {ok:false,error:'Для цієї платформи немає очікування запрошення.'};
  if (action === 'return_to_join' && chat.platform !== 'whatsapp') return {ok:false,error:'Повернення в цю чергу доступне лише для WhatsApp.'};
  if (action === 'assign_account' && (chat.platform !== 'telegram' || !input.accountId)) return {ok:false,error:'Оберіть активний Telegram-акаунт.'};

  const joining = action === 'joined' || action === 'approved';
  const reset = action === 'restore' || action === 'return_to_join';
  const archived = action === 'archive' || action === 'failed';
  const assign = action === 'assign_account';
  const status = joining ? 'ready' : reset ? 'to_join' : archived ? 'archived' : assign ? chat.workflow_status : 'waiting';
  const accountId = chat.platform !== 'telegram' || reset ? null
    : assign ? input.accountId : chat.telegram_account_id ?? input.accountId;
  const needsActiveAccount = chat.platform === 'telegram' && (joining || action === 'waiting' || assign || (!chat.telegram_account_id && accountId !== null));
  const eventId = crypto.randomUUID();
  const reason = (input.reason || '').trim().slice(0,100) || (action === 'failed' ? 'Не вдалося приєднатися' : 'Не актуальний');
  const statements = [
    db.prepare(`UPDATE chats SET workflow_status=?1,
      joined_at=CASE WHEN ?2 THEN ?3 WHEN ?4 THEN NULL ELSE joined_at END,
      processed_at=CASE WHEN ?4 THEN NULL WHEN ?2 OR ?5='waiting' THEN ?3 ELSE processed_at END,
      snoozed_until=CASE WHEN ?5='assign_account' THEN snoozed_until ELSE NULL END,
      archive_reason=CASE WHEN ?5='assign_account' THEN archive_reason WHEN ?6 THEN ?7 ELSE NULL END,
      archived_at=CASE WHEN ?5='assign_account' THEN archived_at WHEN ?6 THEN ?3 ELSE NULL END,
      telegram_account_id=?8,updated_at=?3
      WHERE id=?9 AND user_id=?10 AND ${chatStateTokenSql('chats')}=?11
        AND (?12=0 OR EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=?8 AND a.user_id=?10 AND a.is_enabled=1))`)
      .bind(status,Number(joining),now,Number(reset),action,Number(archived),reason,
        accountId,chat.id,userId,chat.state_token,Number(needsActiveAccount)),
    chatStateEvent(db,{id:eventId,userId,chatId:chat.id,action,now,previous:chat.state_token}),
  ];
  const discoveryMembership = discoveryMembershipForTransition(action);
  if (discoveryMembership) {
    statements.push(discoveryMembershipStatement(db, {
      userId,
      chatId: chat.id,
      eventId,
      membershipState: discoveryMembership,
      now,
    }));
  }
  if (joining) {
    const metricId = crypto.randomUUID();
    // Preserve the established one-chat-per-day metric, including rejoining after
    // restore. Only a newly inserted metric advances the account's join streak.
    statements.push(db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,e.user_id,'chat_joined',e.platform,e.chat_id,e.occurred_at,e.event_date,'{}',?2,e.telegram_account_id
      FROM activity_events e WHERE e.id=?3 AND e.user_id=?4
        AND NOT EXISTS(SELECT 1 FROM activity_events prior WHERE prior.user_id=e.user_id
          AND prior.chat_id=e.chat_id AND prior.event_type='chat_joined'
          AND prior.event_date=e.event_date AND prior.cancelled_at IS NULL)
      ON CONFLICT(user_id,source_key) DO NOTHING`)
      .bind(metricId,`chat-joined:${chat.id}:${businessDate(now)}`,eventId,userId));
    if (chat.platform === 'telegram') statements.push(db.prepare(`UPDATE telegram_accounts
      SET join_streak=CASE WHEN break_until IS NOT NULL AND break_until<=?1 THEN 1 ELSE join_streak+1 END,
        break_until=CASE WHEN break_until<=?1 THEN NULL ELSE break_until END,updated_at=?1
      WHERE id=?2 AND user_id=?3 AND EXISTS(SELECT 1 FROM activity_events e WHERE e.id=?4 AND e.user_id=?3)`)
      .bind(now,accountId,userId,metricId));
  }
  const results = await db.batch(statements);
  return results[0].meta.changes ? {ok:true} : {ok:false,error:'Чат або Telegram-акаунт уже змінено. Оновіть список.'};
}
