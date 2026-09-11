export type ReportHistoryItem = {
  id: string;
  revision: number;
  occurredAt: number;
  eventDate: string;
  submittedAt: number | null;
  text: string;
  source: 'manual' | 'import' | 'unknown';
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
    ORDER BY occurred_at DESC,rowid DESC LIMIT ?3`).bind(userId, date, safeLimit).all<{
      id: string;
      occurred_at: number;
      event_date: string;
      metadata_json: string | null;
    }>();
  return result.results.map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    const source = metadata.source === 'manual' || metadata.source === 'import' ? metadata.source : 'unknown';
    return {
      id: row.id,
      revision: Number.isSafeInteger(metadata.revision) ? Number(metadata.revision) : 1,
      occurredAt: Number(row.occurred_at),
      eventDate: row.event_date,
      submittedAt: typeof metadata.submittedAt === 'number' ? Number(metadata.submittedAt) : null,
      text: typeof metadata.text === 'string' ? metadata.text : '',
      source,
    };
  });
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
