import { businessDate } from '../business-time.ts';
import { discoveryMembershipForTransition, discoveryMembershipStatement } from '../chat-discovery/workflow-link.ts';
import { chatStateEvent, chatStateTokenSql, type ChatState } from './state.ts';

const ALLOWED_FROM: Record<string, readonly string[]> = {
  joined: ['to_join'], waiting: ['to_join'], failed: ['to_join'], approved: ['waiting'],
  archive: ['to_join','waiting','ready'], restore: ['archived'], return_to_join: ['waiting','ready'],
  assign_account: ['waiting','ready','archived'],
  // Telegram: відбір із «Нових чатів» у чергу приєднання вибраного акаунта і зворотний крок.
  shortlist: ['to_join'], unshortlist: ['to_join'],
};

export async function transitionChat(db: D1Database, input: {
  userId: string; chat: ChatState; action: string; accountId: string | null; now: number; reason?: string;
  /** Telegram: `restore` за замовчуванням повертає чат у чергу приєднання; `toPool` — у «Нові чати» (скасування архівації з них). */
  toPool?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { userId, chat, action, now } = input;
  if (!ALLOWED_FROM[action]?.includes(chat.workflow_status)) return {ok:false,error:'Стан чату вже змінився. Оновіть список.'};
  if (action === 'waiting' && !['telegram','whatsapp'].includes(chat.platform)) return {ok:false,error:'Для цієї платформи немає очікування запрошення.'};
  if (action === 'return_to_join' && !['telegram','whatsapp'].includes(chat.platform)) return {ok:false,error:'Повернення в цю чергу доступне лише для Telegram і WhatsApp.'};
  if (action === 'assign_account' && (chat.platform !== 'telegram' || !input.accountId)) return {ok:false,error:'Оберіть активний Telegram-акаунт.'};
  if ((action === 'shortlist' || action === 'unshortlist') && chat.platform !== 'telegram') return {ok:false,error:'Черга приєднання доступна лише для Telegram.'};
  if (action === 'shortlist' && (chat.telegram_account_id !== null || !input.accountId)) return {ok:false,error:'Чат уже в черзі або не обрано активний Telegram-акаунт. Оновіть список.'};
  if (action === 'unshortlist' && chat.telegram_account_id === null) return {ok:false,error:'Чат уже серед нових. Оновіть список.'};

  const telegram = chat.platform === 'telegram';
  const joining = action === 'joined' || action === 'approved';
  const reset = action === 'restore' || action === 'return_to_join';
  const archived = action === 'archive' || action === 'failed';
  const invalidatesTodayJoin = action === 'archive' || action === 'failed' || action === 'return_to_join';
  const assign = action === 'assign_account';
  const queueMove = action === 'shortlist' || action === 'unshortlist';
  // Чат Telegram у черзі приєднання: після відбору, повернення зі «Для публікації»/«Очікування» і відновлення з архіву.
  const wantsQueue = telegram && (action === 'shortlist' || action === 'return_to_join' || (action === 'restore' && !input.toPool));
  const status = joining ? 'ready' : (reset || queueMove) ? 'to_join' : archived ? 'archived' : assign ? chat.workflow_status : 'waiting';
  const accountId = !telegram || action === 'unshortlist' || (reset && !wantsQueue) ? null
    : assign ? input.accountId : chat.telegram_account_id ?? input.accountId;
  // Без акаунта черги немає: такий чат лишається серед нових.
  const toQueue = wantsQueue && accountId !== null;
  const needsActiveAccount = telegram && (joining || action === 'waiting' || assign || action === 'shortlist' || (!chat.telegram_account_id && accountId !== null));
  const eventId = crypto.randomUUID();
  const reason = (input.reason || '').trim().slice(0,100) || (action === 'failed' ? 'Не вдалося приєднатися' : 'Не актуальний');
  const statements = [
    db.prepare(`UPDATE chats SET workflow_status=?1,
      joined_at=CASE WHEN ?2 THEN ?3 WHEN ?4 THEN NULL ELSE joined_at END,
      processed_at=CASE WHEN ?4 THEN NULL WHEN ?2 OR ?5='waiting' THEN ?3 ELSE processed_at END,
      snoozed_until=CASE WHEN ?5='assign_account' THEN snoozed_until ELSE NULL END,
      archive_reason=CASE WHEN ?5='assign_account' THEN archive_reason WHEN ?6 THEN ?7 ELSE NULL END,
      archived_at=CASE WHEN ?5='assign_account' THEN archived_at WHEN ?6 THEN ?3 ELSE NULL END,
      join_candidate_at=CASE WHEN ?5='assign_account' THEN join_candidate_at WHEN ?13 THEN ?3 ELSE NULL END,
      telegram_account_id=?8,updated_at=?3
      WHERE id=?9 AND user_id=?10 AND ${chatStateTokenSql('chats')}=?11
        AND (?12=0 OR EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=?8 AND a.user_id=?10 AND a.is_enabled=1))`)
      .bind(status,Number(joining),now,Number(reset),action,Number(archived),reason,
        accountId,chat.id,userId,chat.state_token,Number(needsActiveAccount),Number(toQueue)),
    chatStateEvent(db,{id:eventId,userId,chatId:chat.id,action,now,previous:chat.state_token}),
  ];
  if (invalidatesTodayJoin) {
    statements.push(db.prepare(`UPDATE activity_events SET cancelled_at=?1
      WHERE user_id=?2 AND chat_id=?3 AND event_type='chat_joined' AND event_date=?4 AND cancelled_at IS NULL
        AND EXISTS(SELECT 1 FROM activity_events transition_event WHERE transition_event.id=?5 AND transition_event.user_id=?2)`)
      .bind(now,userId,chat.id,businessDate(now),eventId));
    // Скасоване сьогоднішнє приєднання відкочує й серію приєднань акаунта: так «Скасувати» після «Приєднано»
    // повертає лічильник «Приєднано N із M» до попереднього значення (рядок лише за ключем акаунта).
    if (chat.platform === 'telegram' && chat.telegram_account_id) {
      statements.push(db.prepare(`UPDATE telegram_accounts SET join_streak=MAX(join_streak-1,0),updated_at=?1
        WHERE id=?2 AND user_id=?3 AND EXISTS(SELECT 1 FROM activity_events e WHERE e.user_id=?3 AND e.chat_id=?4
          AND e.event_type='chat_joined' AND e.event_date=?5 AND e.cancelled_at=?1)`)
        .bind(now,chat.telegram_account_id,userId,chat.id,businessDate(now)));
    }
  }
  // Чат, що повертається в чергу приєднання, перестає бути в слоті розкладу (слот лишається вільним).
  if (telegram && action === 'return_to_join' && chat.telegram_account_id) {
    statements.push(db.prepare(`UPDATE telegram_schedule_slots SET chat_id=NULL,updated_at=?1,version=version+1
      WHERE user_id=?2 AND telegram_account_id=?3 AND chat_id=?4 AND status='pending'
        AND EXISTS(SELECT 1 FROM activity_events transition_event WHERE transition_event.id=?5 AND transition_event.user_id=?2)`)
      .bind(now,userId,chat.telegram_account_id,chat.id,eventId));
  }
  const discoveryMembership = discoveryMembershipForTransition(action);
  if (discoveryMembership) {
    statements.push(discoveryMembershipStatement(db, {
      userId,
      chatId: chat.id,
      eventId,
      membershipState: discoveryMembership,
      now,
      resetInspection: action === 'restore' || action === 'return_to_join',
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
      ON CONFLICT(user_id,source_key) DO UPDATE SET
        cancelled_at=NULL,
        occurred_at=excluded.occurred_at,
        platform=excluded.platform,
        telegram_account_id=excluded.telegram_account_id`)
      .bind(metricId,`chat-joined:${chat.id}:${businessDate(now)}`,eventId,userId));
    if (chat.platform === 'telegram') statements.push(db.prepare(`UPDATE telegram_accounts
      SET join_streak=CASE WHEN break_until IS NOT NULL AND break_until<=?1 THEN 1 ELSE join_streak+1 END,
        break_until=CASE WHEN break_until<=?1 THEN NULL ELSE break_until END,updated_at=?1
      WHERE id=?2 AND user_id=?3 AND EXISTS(SELECT 1 FROM activity_events e WHERE e.user_id=?3 AND e.cancelled_at IS NULL
        AND (e.id=?4 OR (e.source_key=?5 AND e.occurred_at=?1)))`)
      .bind(now,accountId,userId,metricId,`chat-joined:${chat.id}:${businessDate(now)}`));
  }
  const results = await db.batch(statements);
  return results[0].meta.changes ? {ok:true} : {ok:false,error:'Чат або Telegram-акаунт уже змінено. Оновіть список.'};
}
