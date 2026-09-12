export function completedOperatorLessonsStatement(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
) {
  return db.prepare(`SELECT COALESCE(l.platform,'unknown') AS platform,COUNT(*) AS count
    FROM lessons lesson
    JOIN leads l ON l.id=lesson.lead_id AND l.user_id=lesson.user_id
    WHERE lesson.user_id=?1 AND lesson.status='completed'
      AND lesson.lesson_date>=?2 AND lesson.lesson_date<=?3
      AND EXISTS(
        SELECT 1 FROM activity_events e
        WHERE e.user_id=lesson.user_id AND e.lesson_id=lesson.id
          AND e.event_type='lesson_booked' AND e.cancelled_at IS NULL
      )
    GROUP BY COALESCE(l.platform,'unknown')`).bind(userId, from, to);
}
