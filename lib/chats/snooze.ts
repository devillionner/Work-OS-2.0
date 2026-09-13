import { snoozeDeadline } from '../business-time.ts';
import { chatStateEvent, chatStateTokenSql } from './state.ts';

export const CHAT_SNOOZE_ARCHIVE_THRESHOLD = 3;

export async function readChatSnoozeCount(
  db: D1Database,
  userId: string,
  chatId: string,
): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count
    FROM activity_events
    WHERE user_id=?1 AND chat_id=?2 AND event_type='chat_state_changed'
      AND json_extract(metadata_json,'$.action')='snooze'`)
    .bind(userId, chatId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export function shouldSuggestChatArchive(snoozeCount: number): boolean {
  return Number.isFinite(snoozeCount)
    && snoozeCount >= CHAT_SNOOZE_ARCHIVE_THRESHOLD;
}

export async function applyChatSnoozeAction(db: D1Database, input: {
  userId: string; id: string; status: string; previousDeadline: number | null;
  now: number; resume: boolean; stateToken: string;
}): Promise<{ ok: false } | { ok: true; snoozeCount: number; archiveSuggested: boolean }> {
  const ok = await changeChatSnooze(db, input);
  if (!ok) return { ok: false };
  if (input.resume) return { ok: true, snoozeCount: 0, archiveSuggested: false };
  const snoozeCount = await readChatSnoozeCount(db, input.userId, input.id);
  return { ok: true, snoozeCount, archiveSuggested: shouldSuggestChatArchive(snoozeCount) };
}

export async function changeChatSnooze(db: D1Database, input: {
  userId: string; id: string; status: string; previousDeadline: number | null; now: number; resume: boolean; stateToken: string;
}) {
  if (!['waiting', 'ready'].includes(input.status)) return false;
  const deadline = input.resume ? null : snoozeDeadline(input.now);
  const result = await db.batch([
    db.prepare(`UPDATE chats SET snoozed_until=?1,updated_at=?2
      WHERE id=?3 AND user_id=?4 AND workflow_status=?5 AND snoozed_until IS ?6
        AND ${chatStateTokenSql('chats')}=?7`)
      .bind(deadline,input.now,input.id,input.userId,input.status,input.previousDeadline,input.stateToken),
    chatStateEvent(db,{id:crypto.randomUUID(),userId:input.userId,chatId:input.id,
      action:input.resume?'unsnooze':'snooze',now:input.now,previous:input.stateToken}),
  ]);
  return Boolean(result[0].meta.changes);
}
