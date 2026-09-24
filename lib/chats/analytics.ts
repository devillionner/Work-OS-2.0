import { shiftBusinessDate } from '../business-time.ts';

export const CHAT_ANALYTICS_PERIODS = ['7','30','all'] as const;
export type ChatAnalyticsPeriod = (typeof CHAT_ANALYTICS_PERIODS)[number];

export type ChatAnalyticsSummary = {
  publications:number;
  responses:number;
  bookings:number;
  completed:number;
  responseRate:number;
  bookingRate:number;
  completionRate:number;
};

export type ChatAnalyticsEvent = {
  id:string;
  eventType:string;
  eventDate:string;
  occurredAt:number;
  leadId:string|null;
  leadName:string|null;
  lessonId:string|null;
};

export type ChatAnalyticsSnapshot = {
  period:ChatAnalyticsPeriod;
  from:string|null;
  to:string;
  summary:ChatAnalyticsSummary;
  events:ChatAnalyticsEvent[];
};
export async function readChatAnalytics(
  db:D1Database,
  input:{userId:string;chatId:string;period:ChatAnalyticsPeriod;to:string;limit?:number},
):Promise<ChatAnalyticsSnapshot> {
  const from=input.period==='all'?null:shiftBusinessDate(input.to,input.period==='7'?-6:-29);
  const lowerBound=from || '0000-01-01';
  const limit=Math.max(1,Math.min(100,Math.floor(input.limit||50)));
  const [countsResult,eventsResult]=await db.batch([
    db.prepare(`SELECT e.event_type,COUNT(*) AS count
      FROM activity_events e
      LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND COALESCE(e.chat_id,l.source_chat_id)=?2
        AND e.event_date>=?3 AND e.event_date<=?4 AND e.cancelled_at IS NULL
        AND e.event_type IN ('publication','lead_created','lesson_booked','curator_booking_pending','lesson_completed')
      GROUP BY e.event_type`).bind(input.userId,input.chatId,lowerBound,input.to),
    db.prepare(`SELECT e.id,e.event_type,e.event_date,e.occurred_at,e.lead_id,l.name AS lead_name,e.lesson_id
      FROM activity_events e
      LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND COALESCE(e.chat_id,l.source_chat_id)=?2
        AND e.event_date>=?3 AND e.event_date<=?4 AND e.cancelled_at IS NULL
        AND e.event_type IN ('publication','lead_created','lesson_booked','curator_booking_pending','lesson_completed')
      ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT ?5`).bind(input.userId,input.chatId,lowerBound,input.to,limit),
  ]);
  const counts=new Map((countsResult.results as Array<{event_type:string;count:number}>).map(row=>[row.event_type,Number(row.count)||0]));
  const publications=counts.get('publication')||0;
  const responses=counts.get('lead_created')||0;
  const bookings=(counts.get('lesson_booked')||0)+(counts.get('curator_booking_pending')||0);
  const completed=counts.get('lesson_completed')||0;
  const percent=(value:number,total:number)=>total?Math.round(value*1000/total)/10:0;
  const events=(eventsResult.results as Array<Record<string,unknown>>).map(row=>({
    id:String(row.id),
    eventType:String(row.event_type),
    eventDate:String(row.event_date),
    occurredAt:Number(row.occurred_at),
    leadId:typeof row.lead_id==='string'?row.lead_id:null,
    leadName:typeof row.lead_name==='string'?row.lead_name:null,
    lessonId:typeof row.lesson_id==='string'?row.lesson_id:null,
  }));
  return {
    period:input.period,
    from,
    to:input.to,
    summary:{
      publications,responses,bookings,completed,
      responseRate:percent(responses,publications),
      bookingRate:percent(bookings,responses),
      completionRate:percent(completed,bookings),
    },
    events,
  };
}
