export type ChatHistoryItem = {
  id: string; eventType: string; occurredAt: number; eventDate: string; cancelledAt: number | null;
  advertisementId: string | null; advertisementTitle: string | null;
  metadata: Record<string, unknown>;
};

export async function readChatHistory(db: D1Database, userId: string, chatId: string, limit = 50): Promise<ChatHistoryItem[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const result = await db.prepare(`SELECT e.id,e.event_type,e.occurred_at,e.event_date,e.cancelled_at,e.metadata_json,
      COALESCE(p.advertisement_id,json_extract(e.metadata_json,'$.advertisementId')) AS advertisement_id,
      li.title AS advertisement_title
    FROM activity_events e JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
      LEFT JOIN chat_publications p ON p.user_id=e.user_id AND p.source_key=e.source_key
      LEFT JOIN library_items li ON li.id=COALESCE(p.advertisement_id,json_extract(e.metadata_json,'$.advertisementId')) AND li.user_id=e.user_id
    WHERE e.user_id=?1 AND e.chat_id=?2 ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?3`)
    .bind(userId, chatId, safeLimit).all<{ id:string; event_type:string; occurred_at:number; event_date:string; cancelled_at:number|null; metadata_json:string|null; advertisement_id:string|null; advertisement_title:string|null }>();
  return result.results.map(row => ({ id:row.id, eventType:row.event_type, occurredAt:Number(row.occurred_at), eventDate:row.event_date, cancelledAt:row.cancelled_at===null?null:Number(row.cancelled_at), advertisementId:row.advertisement_id || null, advertisementTitle:row.advertisement_title || null, metadata:parseMetadata(row.metadata_json) }));
}

function parseMetadata(value: string|null): Record<string, unknown> {
  if (!value) return {};
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
