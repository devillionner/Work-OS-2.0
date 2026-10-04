// Per-chat activity breakdown for the Analytics page (top 100 chats of a date range).
//
// Events are grouped per chat first and only the resulting groups are joined to chats/chat_profiles.
// The former single query joined chats and chat_profiles for every event before grouping (≈3.3 rows
// read per event). Only the five counted event types are read: any other type adds nothing but zero
// counters, and a group with only zeros is dropped by the HAVING anyway, so the result is identical.
// Attribution is unchanged: an event without its own chat counts for its lead's source chat, resolved
// live through leads.
export function chatActivityStatement(db: D1Database, userId: string, from: string, to: string) {
  return db.prepare(`WITH totals AS MATERIALIZED (
      SELECT COALESCE(e.chat_id,l.source_chat_id) AS chat_key,
        SUM(CASE WHEN e.event_type='chat_joined' THEN 1 ELSE 0 END) AS joined,
        SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
        SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
        SUM(CASE WHEN e.event_type IN ('lesson_booked','curator_booking_pending') THEN 1 ELSE 0 END) AS bookings
      FROM activity_events e
      LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
        AND e.event_type IN ('chat_joined','publication','lead_created','lesson_booked','curator_booking_pending')
      GROUP BY COALESCE(e.chat_id,l.source_chat_id)
      HAVING chat_key IS NOT NULL)
    SELECT totals.chat_key AS chat_id,c.name,c.platform,c.workflow_status,pr.language,pr.directions_json,
      totals.joined,totals.publications,totals.responses,totals.bookings
    FROM totals
    LEFT JOIN chats c ON c.id=totals.chat_key AND c.user_id=?1
    LEFT JOIN chat_profiles pr ON pr.chat_id=c.id
    ORDER BY totals.publications DESC,totals.responses DESC,totals.bookings DESC,totals.joined DESC,c.name ASC LIMIT 100`).bind(userId, from, to);
}
