import { shiftBusinessDate } from '../business-time.ts';

export type PreviousReportReminder = { date: string; pending: boolean };

export async function readPreviousReportReminder(
  db: D1Database,
  userId: string,
  today: string,
): Promise<PreviousReportReminder> {
  const date = shiftBusinessDate(today, -1);
  const row = await db.prepare(`SELECT
      EXISTS(SELECT 1 FROM workdays w WHERE w.user_id=?1 AND w.work_date=?2) AS had_workday,
      EXISTS(SELECT 1 FROM daily_reports r WHERE r.user_id=?1 AND r.report_date=?2) AS had_report,
      EXISTS(SELECT 1 FROM daily_reports r WHERE r.user_id=?1 AND r.report_date=?2 AND r.submitted_at IS NOT NULL) AS submitted,
      EXISTS(SELECT 1 FROM activity_events e WHERE e.user_id=?1 AND e.event_date=?2
        AND e.event_type NOT IN ('chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision')) AS had_activity`)
    .bind(userId, date).first<{ had_workday: number; had_report: number; submitted: number; had_activity: number }>();
  const hadWork = Boolean(row?.had_workday || row?.had_report || row?.had_activity);
  return { date, pending: hadWork && !row?.submitted };
}
