import { shiftBusinessDate } from './business-time.ts';

export type AnalyticsTrendPoint = {
  date: string;
  joined: number;
  publications: number;
  responses: number;
  bookings: number;
  completed: number;
};

type EventTrendRow = { event_date: string; event_type: string; count: number };
type LessonTrendRow = { lesson_date: string; count: number };

export async function readAnalyticsTrends(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
): Promise<AnalyticsTrendPoint[]> {
  const [eventsResult, lessonsResult] = await db.batch([
    db.prepare(`SELECT event_date,event_type,COUNT(*) AS count
      FROM activity_events
      WHERE user_id=?1 AND event_date>=?2 AND event_date<=?3 AND cancelled_at IS NULL
        AND event_type IN ('chat_joined','publication','lead_created','lesson_booked','curator_booking_pending')
      GROUP BY event_date,event_type ORDER BY event_date,event_type`).bind(userId,from,to),
    db.prepare(`SELECT lesson.lesson_date,COUNT(*) AS count
      FROM lessons lesson
      WHERE lesson.user_id=?1 AND lesson.status='completed'
        AND lesson.lesson_date>=?2 AND lesson.lesson_date<=?3
        AND EXISTS(SELECT 1 FROM activity_events e
          WHERE e.user_id=lesson.user_id AND e.lesson_id=lesson.id
            AND e.event_type='lesson_booked' AND e.cancelled_at IS NULL)
      GROUP BY lesson.lesson_date ORDER BY lesson.lesson_date`).bind(userId,from,to),
  ]);

  const byDate = new Map<string, AnalyticsTrendPoint>();
  for (let date=from;date<=to;date=shiftBusinessDate(date,1)) {
    byDate.set(date,{date,joined:0,publications:0,responses:0,bookings:0,completed:0});
  }
  for (const row of eventsResult.results as EventTrendRow[]) {
    const point=byDate.get(row.event_date); if(!point) continue;
    const count=Number(row.count||0);
    if(row.event_type==='chat_joined') point.joined+=count;
    if(row.event_type==='publication') point.publications+=count;
    if(row.event_type==='lead_created') point.responses+=count;
    if(row.event_type==='lesson_booked'||row.event_type==='curator_booking_pending') point.bookings+=count;
  }
  for (const row of lessonsResult.results as LessonTrendRow[]) {
    const point=byDate.get(row.lesson_date); if(point) point.completed=Number(row.count||0);
  }
  return [...byDate.values()];
}
