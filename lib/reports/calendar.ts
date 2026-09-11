export type ReportCalendarItem = {
  id: string;
  date: string;
  text: string;
  submittedAt: number | null;
  updatedAt: number;
  revisionCount: number;
  stale: boolean;
};

type ReportCalendarRow = {
  id: string;
  report_date: string;
  report_text: string;
  submitted_at: number | null;
  updated_at: number;
  revision_count: number;
  stale: number;
};

export async function readReportCalendar(db: D1Database, userId: string, start: string, end: string): Promise<ReportCalendarItem[]> {
  const result = await db.prepare(`SELECT r.id,r.report_date,r.report_text,r.submitted_at,r.updated_at,r.revision_count,
    EXISTS(SELECT 1 FROM activity_events e
      WHERE e.user_id=r.user_id AND e.event_date=r.report_date
        AND e.event_type NOT IN ('chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision')
        AND r.submitted_at IS NOT NULL
        AND (e.occurred_at>r.submitted_at OR e.cancelled_at>r.submitted_at)) AS stale
    FROM daily_reports r
    WHERE r.user_id=?1 AND r.report_date>=?2 AND r.report_date<?3
    ORDER BY r.report_date`).bind(userId, start, end).all<ReportCalendarRow>();
  return result.results.map((row) => ({
    id: row.id,
    date: row.report_date,
    text: row.report_text,
    submittedAt: row.submitted_at,
    updatedAt: Number(row.updated_at),
    revisionCount: Number(row.revision_count || 1),
    stale: Boolean(row.stale),
  }));
}
