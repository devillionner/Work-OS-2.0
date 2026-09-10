export type PublicationChat = {
  id: string;
  platform: string;
  workflow_status: string;
  joined_at: number | null;
  snoozed_until: number | null;
};

export function publicationAvailability(chat: PublicationChat, now: number) {
  const telegramAt = chat.platform === 'telegram' && chat.joined_at !== null
    ? chat.joined_at + 21600 : 0;
  const availableAt = Math.max(telegramAt, chat.snoozed_until ?? 0) || null;
  const availableNow = chat.workflow_status === 'ready' && (availableAt === null || availableAt <= now);
  return { availableAt, availableNow };
}

export async function recordManualPublication(
  db: D1Database,
  input: { userId: string; chat: PublicationChat; accountId: string | null; now: number; date: string },
): Promise<{ ok: true } | { ok: false; error: string; availableAt?: number | null }> {
  const { userId, chat, accountId, now, date } = input;
  const availability = publicationAvailability(chat, now);
  if (!availability.availableNow) {
    return { ok: false, ...availability, error: chat.workflow_status !== 'ready'
      ? 'Цей чат зараз не в черзі публікації.'
      : (chat.snoozed_until ?? 0) > now ? 'Цей чат відкладено. Публікація ще недоступна.' : 'Для Telegram ще не минуло 6 годин.' };
  }
  const publicationId = crypto.randomUUID();
  const sourceKey = `manual:${publicationId}`;
  // Recheck the current row inside the same transaction as the event. A racing
  // archive/snooze or duplicate click must not create a publication or an event.
  const results = await db.batch([
    db.prepare(`INSERT INTO chat_publications
      (id,user_id,chat_id,published_on,published_at,source,source_key,created_at,telegram_account_id)
      SELECT ?1,c.user_id,c.id,?2,?3,'manual',?4,?3,CASE WHEN c.platform='telegram' THEN COALESCE(c.telegram_account_id,?5) ELSE NULL END
      FROM chats c WHERE c.id=?6 AND c.user_id=?7 AND c.workflow_status='ready'
        AND (c.snoozed_until IS NULL OR c.snoozed_until<=?3)
        AND (c.platform!='telegram' OR c.joined_at IS NULL OR c.joined_at+21600<=?3)
      ON CONFLICT(user_id,chat_id,published_on) DO NOTHING`)
      .bind(publicationId,date,now,sourceKey,accountId,chat.id,userId),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,p.user_id,'publication',c.platform,p.chat_id,NULL,NULL,p.published_at,p.published_on,'{}',p.source_key,p.telegram_account_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.id=?2 AND p.user_id=?3`).bind(crypto.randomUUID(),publicationId,userId),
    db.prepare(`UPDATE chats SET updated_at=?1 WHERE id=?2 AND user_id=?3
      AND EXISTS(SELECT 1 FROM chat_publications p WHERE p.id=?4 AND p.user_id=?3)`)
      .bind(now,chat.id,userId,publicationId),
  ]);
  return results[0].meta.changes ? { ok: true }
    : { ok: false, error: 'Чат уже змінено або сьогодні в ньому вже публікували. Оновіть список.' };
}
