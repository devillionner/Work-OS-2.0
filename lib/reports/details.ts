import { businessDate } from '../business-time.ts';

export type ReportEventDetail = {
  id: string;
  eventType: string;
  platform: string | null;
  chatId: string | null;
  leadId: string | null;
  lessonId: string | null;
  occurredAt: number;
  eventDate: string;
  chatName: string | null;
  leadName: string | null;
  leadSubject: string | null;
  lessonSubject: string | null;
};

type ReportEventRow = {
  id: string;
  event_type: string;
  platform: string | null;
  chat_id: string | null;
  lead_id: string | null;
  lesson_id: string | null;
  occurred_at: number;
  event_date: string;
  chat_name: string | null;
  lead_name: string | null;
  lead_subject: string | null;
  lesson_subject: string | null;
};

const BACKDATED_LABEL = 'Додано заднім числом';

export async function readReportEventDetails(db: D1Database, userId: string, date: string, limit = 200): Promise<ReportEventDetail[]> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit) || 200));
  const result = await db.prepare(`SELECT e.id,e.event_type,e.platform,e.chat_id,e.lead_id,e.lesson_id,e.occurred_at,e.event_date,
      c.name AS chat_name,l.name AS lead_name,l.subject AS lead_subject,ls.subject AS lesson_subject
    FROM activity_events e
    LEFT JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN lessons ls ON ls.id=e.lesson_id AND ls.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date=?2 AND e.cancelled_at IS NULL
      AND e.event_type IN ('chat_joined','publication','lead_created','lesson_booked','curator_booking_pending')
    ORDER BY e.occurred_at,e.id LIMIT ${boundedLimit}`).bind(userId, date).all<ReportEventRow>();
  return result.results.map((row) => {
    const occurredAt = Number(row.occurred_at);
    const backdated = ['lead_created', 'lesson_booked', 'curator_booking_pending'].includes(row.event_type)
      && row.event_date < businessDate(occurredAt);
    return {
      id: row.id,
      eventType: row.event_type,
      platform: row.platform,
      chatId: row.chat_id,
      leadId: row.lead_id,
      lessonId: row.lesson_id,
      occurredAt,
      eventDate: row.event_date,
      chatName: row.chat_name,
      leadName: row.lead_name && backdated ? `${row.lead_name} · ${BACKDATED_LABEL}` : row.lead_name,
      leadSubject: row.lead_subject,
      lessonSubject: row.lesson_subject,
    };
  });
}
