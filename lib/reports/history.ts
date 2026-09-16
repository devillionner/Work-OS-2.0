import { validateReportManualAdjustments, type ReportManualAdjustments } from './manual-adjustments.ts';

export type ReportHistoryItem = {
  id: string;
  revision: number;
  occurredAt: number;
  eventDate: string;
  submittedAt: number | null;
  text: string;
  source: 'manual' | 'import' | 'unknown';
  manualAdjustments: ReportManualAdjustments | null;
};

type RevisionRow = {
  id: string;
  occurred_at: number;
  event_date: string;
  metadata_json: string | null;
};

type ReportBaselineRow = {
  id: string;
  report_date: string;
  report_text: string;
  payload_json: string | null;
  submitted_at: number | null;
  updated_at: number;
  revision_count: number | null;
  source_import_id: string | null;
};

export async function readReportHistory(
  db: D1Database,
  userId: string,
  date: string,
  limit = 50,
): Promise<ReportHistoryItem[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const result = await db.prepare(`SELECT id,occurred_at,event_date,metadata_json
    FROM activity_events
    WHERE user_id=?1 AND event_type='report_revision' AND event_date=?2
    ORDER BY occurred_at DESC,rowid DESC LIMIT ?3`).bind(userId, date, safeLimit).all<RevisionRow>();
  if (result.results.length) return result.results.map(projectRevision);

  // Reports imported or restored before the revision trigger existed have a valid
  // current row but no historical activity event. Expose that persisted row as
  // the baseline instead of presenting an empty history dialog. This is read-only:
  // it does not invent intermediate revisions or backfill D1.
  const baseline = await db.prepare(`SELECT id,report_date,report_text,payload_json,submitted_at,updated_at,
      revision_count,source_import_id
    FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`)
    .bind(userId, date).first<ReportBaselineRow>();
  return baseline ? [projectBaseline(baseline)] : [];
}

function projectRevision(row: RevisionRow): ReportHistoryItem {
  const metadata = parseMetadata(row.metadata_json);
  const source = metadata.source === 'manual' || metadata.source === 'import' ? metadata.source : 'unknown';
  const manualAdjustments = metadata.manualAdjustments === undefined
    ? null
    : validateReportManualAdjustments(metadata.manualAdjustments);
  return {
    id: row.id,
    revision: Number.isSafeInteger(metadata.revision) ? Number(metadata.revision) : 1,
    occurredAt: Number(row.occurred_at),
    eventDate: row.event_date,
    submittedAt: typeof metadata.submittedAt === 'number' ? Number(metadata.submittedAt) : null,
    text: typeof metadata.text === 'string' ? metadata.text : '',
    source,
    manualAdjustments,
  };
}

function projectBaseline(row: ReportBaselineRow): ReportHistoryItem {
  const payload = parseMetadata(row.payload_json);
  return {
    id: `baseline:${row.id}`,
    revision: Math.max(1, Number(row.revision_count || 1)),
    occurredAt: Number(row.updated_at),
    eventDate: row.report_date,
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    text: row.report_text,
    source: row.source_import_id ? 'import' : payload.source === 'manual' ? 'manual' : 'unknown',
    manualAdjustments: payload.manualAdjustments === undefined
      ? null
      : validateReportManualAdjustments(payload.manualAdjustments),
  };
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
