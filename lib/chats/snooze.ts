import { snoozeDeadline } from '../business-time.ts';
import { chatStateEvent, chatStateTokenSql } from './state.ts';

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
