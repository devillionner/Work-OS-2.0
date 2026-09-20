import { reportStaleSql } from './activity-revision.ts';

export type ReportCalendarItem = {
  id: string;
  date: string;
  text: string;
  submittedAt: number | null;
  updatedAt: number;
  revisionCount: number;
  submissionCount: number;
  stale: boolean;
};

type ReportCalendarRow = {
  id: string;
  report_date: string;
  report_text: string;
  submitted_at: number | null;
  updated_at: number;
  revision_count: number;
  submission_count: number;
  stale: number;
};

export async function readReportCalendar(db: D1Database, userId: string, start: string, end: string): Promise<ReportCalendarItem[]> {
  const result = await db.prepare(`SELECT r.id,r.report_date,r.report_text,r.submitted_at,r.updated_at,r.revision_count,
    CASE WHEN r.submitted_at IS NULL THEN 0 ELSE MAX(1,(SELECT COUNT(DISTINCT CAST(json_extract(e.metadata_json,'$.submittedAt') AS INTEGER))
      FROM activity_events e WHERE e.user_id=r.user_id AND e.event_type='report_revision' AND e.event_date=r.report_date
        AND json_extract(e.metadata_json,'$.reportId')=r.id AND json_extract(e.metadata_json,'$.submittedAt') IS NOT NULL)) END AS submission_count,
    ${reportStaleSql('r')} AS stale
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
    submissionCount: Number(row.submission_count || 0),
    stale: Boolean(row.stale),
  }));
}
