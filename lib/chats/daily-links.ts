export function joinedTodayStatement(db: D1Database, input: {
  userId: string; platform: string; date: string; accountId: string | null;
}) {
  return db.prepare(`SELECT c.name,c.link FROM activity_events e
    JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    WHERE e.user_id=?1 AND COALESCE(e.platform,c.platform)=?2 AND e.event_date=?3
      AND e.event_type='chat_joined' AND e.cancelled_at IS NULL
      AND (?2!='telegram' OR e.telegram_account_id=?4)
    GROUP BY c.id ORDER BY MIN(e.occurred_at),c.id`)
    .bind(input.userId,input.platform,input.date,input.accountId);
}
