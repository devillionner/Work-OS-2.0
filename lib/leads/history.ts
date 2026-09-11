export type LeadHistoryItem = {
  id: string;
  eventType: string;
  platform: string | null;
  occurredAt: number;
  eventDate: string;
  lessonId: string | null;
  cancelledAt: number | null;
  metadata: Record<string, unknown>;
};

export async function readLeadHistory(
  db: D1Database,
  userId: string,
  leadId: string,
  limit = 50,
): Promise<LeadHistoryItem[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const result = await db
    .prepare(`SELECT e.id,e.event_type,e.platform,e.occurred_at,e.event_date,e.lesson_id,e.cancelled_at,e.metadata_json
      FROM activity_events e JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND e.lead_id=?2 ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?3`)
    .bind(userId, leadId, safeLimit)
    .all<{
      id: string;
      event_type: string;
      platform: string | null;
      occurred_at: number;
      event_date: string;
      lesson_id: string | null;
      cancelled_at: number | null;
      metadata_json: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    platform: row.platform,
    occurredAt: Number(row.occurred_at),
    eventDate: row.event_date,
    lessonId: row.lesson_id,
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    metadata: parseMetadata(row.metadata_json),
  }));
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
