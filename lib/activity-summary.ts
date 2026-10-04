export type ActivitySummaryRow = {
  platform: string | null;
  event_type: string;
  count: number;
  changes_after_report: number;
};

const SUMMARY_EXCLUDED_TYPES = `'chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision'`;

export function activitySummaryStatement(db: D1Database, userId: string, from: string, to: string, submittedAt: number | null = null) {
  // Without a submitted report there is nothing to compare event times against, so the counts come
  // from activity_daily_counts (migration 0041) instead of reading every event of the range. Events
  // with their own platform are counted there exactly; events without one (lead events) are still
  // attributed live through their lead/chat, found through the partial `platform IS NULL` index.
  // Merging both by the resolved platform gives the same rows as the full query below.
  if (submittedAt === null) {
    return db.prepare(`SELECT platform,event_type,SUM(count) AS count,0 AS changes_after_report FROM (
        SELECT d.platform AS platform,d.event_type AS event_type,SUM(d.active_count) AS count
        FROM activity_daily_counts d
        WHERE d.user_id=?1 AND d.event_date>=?2 AND d.event_date<=?3 AND d.platform<>'~none'
          AND d.event_type NOT IN (${SUMMARY_EXCLUDED_TYPES})
        GROUP BY d.platform,d.event_type
        HAVING SUM(d.active_count+d.cancelled_count)>0
        UNION ALL
        SELECT COALESCE(l.platform,c.platform) AS platform,e.event_type AS event_type,
          SUM(CASE WHEN e.cancelled_at IS NULL THEN 1 ELSE 0 END) AS count
        FROM activity_events e
        LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
        LEFT JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
        WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.platform IS NULL
          AND e.event_type NOT IN (${SUMMARY_EXCLUDED_TYPES})
        GROUP BY COALESCE(l.platform,c.platform),e.event_type)
      GROUP BY platform,event_type`).bind(userId,from,to);
  }
  return db.prepare(`SELECT COALESCE(e.platform,l.platform,c.platform) AS platform,e.event_type,
    SUM(CASE WHEN e.cancelled_at IS NULL THEN 1 ELSE 0 END) AS count,
    SUM(CASE WHEN ?4 IS NOT NULL AND (e.occurred_at>?4 OR e.cancelled_at>?4) THEN 1 ELSE 0 END) AS changes_after_report
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3
      AND e.event_type NOT IN (${SUMMARY_EXCLUDED_TYPES})
    GROUP BY COALESCE(e.platform,l.platform,c.platform),e.event_type`).bind(userId,from,to,submittedAt);
}

export function activityTotals(rows: ActivitySummaryRow[]) {
  const totals = { publications: 0, joined: 0, responses: 0, bookings: 0 };
  for (const row of rows) {
    const count = Number(row.count || 0);
    if (row.event_type === 'publication') totals.publications += count;
    if (row.event_type === 'chat_joined') totals.joined += count;
    if (row.event_type === 'lead_created') totals.responses += count;
    if (row.event_type === 'lesson_booked' || row.event_type === 'curator_booking_pending') totals.bookings += count;
  }
  return totals;
}
