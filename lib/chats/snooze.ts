import { snoozeDeadline } from '../business-time.ts';

export async function changeChatSnooze(db: D1Database, input: {
  userId: string; id: string; status: string; previousDeadline: number | null; now: number; resume: boolean;
}) {
  if (!['waiting', 'ready'].includes(input.status)) return false;
  const deadline = input.resume ? null : snoozeDeadline(input.now);
  const result = await db.prepare(`UPDATE chats SET snoozed_until=?1,updated_at=?2
    WHERE id=?3 AND user_id=?4 AND workflow_status=?5 AND snoozed_until IS ?6`)
    .bind(deadline,input.now,input.id,input.userId,input.status,input.previousDeadline).run();
  return Boolean(result.meta.changes);
}
