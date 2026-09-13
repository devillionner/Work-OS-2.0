import { businessDate } from '../business-time.ts';
import { cleanChatName } from './bulk-input.ts';
import { chatStateTokenSql } from './state.ts';

export async function renameDuplicateChat(db: D1Database, input: {
  userId: string;
  id: string;
  stateToken: string;
  name: unknown;
  now: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof input.name !== 'string') return { ok: false, error: 'Некоректна назва чату.' };
  const name = cleanChatName(input.name);
  if (!name) return { ok: false, error: 'Назва чату не може бути порожньою.' };
  const eventId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`UPDATE chats SET name=?1,updated_at=?2
      WHERE id=?3 AND user_id=?4 AND ${chatStateTokenSql('chats')}=?5`)
      .bind(name, input.now, input.id, input.userId, input.stateToken),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,c.user_id,'chat_state_changed',c.platform,c.id,?2,?3,
        json_object('action','rename_duplicate_review','name',c.name),?4,c.telegram_account_id
      FROM chats c WHERE c.id=?5 AND c.user_id=?6 AND changes()=1`)
      .bind(eventId, input.now, businessDate(input.now), `chat-duplicate-rename:${eventId}`, input.id, input.userId),
  ]);
  return results[0].meta.changes
    ? { ok: true }
    : { ok: false, error: 'Чат уже змінився. Оновіть список дублікатів.' };
}
