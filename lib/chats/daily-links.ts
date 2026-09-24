import { isoWeekday, profilePublicationEligibilitySql } from './profile.ts';

export function joinedTodayStatement(db: D1Database, input: {
  userId: string; platform: string; date: string; accountId: string | null;
}) {
  return db.prepare(`SELECT c.id,c.name,c.link FROM activity_events e
    JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    WHERE e.user_id=?1 AND COALESCE(e.platform,c.platform)=?2 AND e.event_date=?3
      AND e.event_type='chat_joined' AND e.cancelled_at IS NULL
      AND c.joined_at IS NOT NULL AND c.workflow_status IN ('waiting','ready')
      AND (?2!='telegram' OR e.telegram_account_id=?4)
    GROUP BY c.id ORDER BY MIN(e.occurred_at),c.id`)
    .bind(input.userId,input.platform,input.date,input.accountId);
}

export function availableTodayStatement(db: D1Database, input: {
  userId: string; platform: string; date: string; accountId: string | null; now: number;
}) {
  return db.prepare(`SELECT c.id,c.name,c.link FROM chats c
    WHERE c.user_id=?1 AND c.platform=?2 AND c.workflow_status='ready'
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?5)
      AND (c.platform!='telegram' OR c.joined_at IS NULL OR c.joined_at+21600<=?5)
      AND (?2!='telegram' OR c.telegram_account_id=?4)
      AND NOT EXISTS(SELECT 1 FROM chat_discovery_candidates dc
        WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target')
      AND NOT EXISTS(SELECT 1 FROM chat_publications p
        WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?3)
      AND ${profilePublicationEligibilitySql('?3','?6')}
    ORDER BY c.updated_at DESC,c.name LIMIT 200`)
    .bind(input.userId,input.platform,input.date,input.accountId,input.now,isoWeekday(input.date));
}
