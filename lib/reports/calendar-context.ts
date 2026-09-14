import { businessDate, businessDayStart } from '../business-time.ts';
import type { CalendarDayContext } from './calendar-labels.ts';

export type { CalendarDayContext } from './calendar-labels.ts';

type WorkdayRow = { work_date: string; status: CalendarDayContext['workdayStatus']; active_seconds: number };
type CountRow = { date: string; count: number };
type LessonCountRow = CountRow & { status: string };
type FollowUpRow = { next_contact_at: number };

export async function readCalendarContext(
  db: D1Database,
  userId: string,
  start: string,
  end: string,
): Promise<CalendarDayContext[]> {
  const startAt = businessDayStart(start);
  const endAt = businessDayStart(end);
  const [workdays, lessons, followUps, leadEvents] = await Promise.all([
    db.prepare(`SELECT work_date,status,active_seconds FROM workdays
      WHERE user_id=?1 AND work_date>=?2 AND work_date<?3 ORDER BY work_date`)
      .bind(userId, start, end).all<WorkdayRow>(),
    db.prepare(`SELECT lesson_date AS date,status,COUNT(*) AS count FROM lessons
      WHERE user_id=?1 AND lesson_date>=?2 AND lesson_date<?3 AND status!='rescheduled'
      GROUP BY lesson_date,status ORDER BY lesson_date,status`)
      .bind(userId, start, end).all<LessonCountRow>(),
    db.prepare(`SELECT next_contact_at FROM leads
      WHERE user_id=?1 AND archived_at IS NULL AND next_contact_at IS NOT NULL
        AND next_contact_at>=?2 AND next_contact_at<?3`)
      .bind(userId, startAt, endAt).all<FollowUpRow>(),
    db.prepare(`SELECT event_date AS date,COUNT(*) AS count FROM activity_events
      WHERE user_id=?1 AND event_date>=?2 AND event_date<?3
        AND lead_id IS NOT NULL AND cancelled_at IS NULL
      GROUP BY event_date ORDER BY event_date`)
      .bind(userId, start, end).all<CountRow>(),
  ]);

  const days = new Map<string, CalendarDayContext>();
  const get = (date: string) => {
    let value = days.get(date);
    if (!value) {
      value = { date, workdayStatus: null, activeSeconds: 0, lessons: 0, lessonsPlanned: 0, lessonsCompleted: 0, followUps: 0, leadEvents: 0 };
      days.set(date, value);
    }
    return value;
  };

  for (const row of workdays.results) {
    const day = get(row.work_date);
    day.workdayStatus = row.status;
    day.activeSeconds = Number(row.active_seconds || 0);
  }
  for (const row of lessons.results) {
    const day = get(row.date);
    const count = Number(row.count || 0);
    day.lessons += count;
    if (row.status === 'booked' || row.status === 'scheduled') day.lessonsPlanned += count;
    if (row.status === 'completed') day.lessonsCompleted += count;
  }
  for (const row of followUps.results) get(businessDate(Number(row.next_contact_at))).followUps += 1;
  for (const row of leadEvents.results) get(row.date).leadEvents = Number(row.count || 0);

  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}
