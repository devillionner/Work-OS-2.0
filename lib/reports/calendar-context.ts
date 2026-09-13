import { businessDate, businessDayStart } from '../business-time.ts';

export type CalendarDayContext = {
  date: string;
  workdayStatus: 'active' | 'paused' | 'ended' | null;
  activeSeconds: number;
  lessons: number;
  followUps: number;
  leadEvents: number;
};

type WorkdayRow = { work_date: string; status: CalendarDayContext['workdayStatus']; active_seconds: number };
type CountRow = { date: string; count: number };
type FollowUpRow = { next_contact_at: number };

export function calendarContextLabels(date: string, context?: CalendarDayContext): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const labels = [context?.workdayStatus ? 'Робочий' : day === 0 || day === 6 ? 'Вихідний' : ''];
  if (context?.lessons) labels.push(`Уроки ${context.lessons}`);
  if (context?.followUps) labels.push(`Follow-up ${context.followUps}`);
  if (context?.leadEvents) labels.push(`CRM ${context.leadEvents}`);
  return labels.filter(Boolean);
}

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
    db.prepare(`SELECT lesson_date AS date,COUNT(*) AS count FROM lessons
      WHERE user_id=?1 AND lesson_date>=?2 AND lesson_date<?3 AND status!='rescheduled'
      GROUP BY lesson_date ORDER BY lesson_date`)
      .bind(userId, start, end).all<CountRow>(),
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
      value = { date, workdayStatus: null, activeSeconds: 0, lessons: 0, followUps: 0, leadEvents: 0 };
      days.set(date, value);
    }
    return value;
  };

  for (const row of workdays.results) {
    const day = get(row.work_date);
    day.workdayStatus = row.status;
    day.activeSeconds = Number(row.active_seconds || 0);
  }
  for (const row of lessons.results) get(row.date).lessons = Number(row.count || 0);
  for (const row of followUps.results) get(businessDate(Number(row.next_contact_at))).followUps += 1;
  for (const row of leadEvents.results) get(row.date).leadEvents = Number(row.count || 0);

  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}
