export async function readActivityDayRevision(
  db: D1Database,
  userId: string,
  date: string,
): Promise<number> {
  const row = await db.prepare(`SELECT revision FROM activity_day_revisions
    WHERE user_id=?1 AND event_date=?2 LIMIT 1`).bind(userId,date).first<{revision:number}>();
  return Number(row?.revision || 0);
}

export function reportStaleSql(reportAlias = 'r'): string {
  return `CASE
    WHEN ${reportAlias}.submitted_at IS NULL THEN 0
    WHEN ${reportAlias}.submitted_activity_revision IS NOT NULL THEN
      COALESCE((SELECT d.revision FROM activity_day_revisions d
        WHERE d.user_id=${reportAlias}.user_id AND d.event_date=${reportAlias}.report_date),0)
        != ${reportAlias}.submitted_activity_revision
    ELSE EXISTS(SELECT 1 FROM activity_events e
      WHERE e.user_id=${reportAlias}.user_id AND e.event_date=${reportAlias}.report_date
        AND e.event_type NOT IN ('chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision')
        AND (e.occurred_at>${reportAlias}.submitted_at OR e.cancelled_at>${reportAlias}.submitted_at))
  END`;
}
