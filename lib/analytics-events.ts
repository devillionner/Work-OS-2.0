export type AnalyticsMetricKey = 'publications' | 'responses' | 'bookings' | 'completed';

export type AnalyticsMetricEvent = {
  id:string;
  eventType:string;
  platform:string|null;
  eventDate:string;
  occurredAt:number;
  chatName:string|null;
  leadName:string|null;
  lessonSubject:string|null;
};

const METRICS: Record<AnalyticsMetricKey,{label:string;definition:string;formula:string;eventTypes:string[]}> = {
  publications:{label:'Публікації',definition:'Підтверджені факти публікації оголошень за датою події.',formula:'Кількість активних подій publication.',eventTypes:['publication']},
  responses:{label:'Відгуки',definition:'Активні відгуки лідів, отримані у вибраному періоді.',formula:'Кількість нескасованих подій lead_created.',eventTypes:['lead_created']},
  bookings:{label:'Записи',definition:'Окремі записи на урок плюс активні запити куратору, які ще рахуються як запис.',formula:'lesson_booked + curator_booking_pending без скасованих подій.',eventTypes:['lesson_booked','curator_booking_pending']},
  completed:{label:'Проведені уроки',definition:'Уроки, позначені як проведені у вибраному періоді.',formula:'Кількість нескасованих подій lesson_completed.',eventTypes:['lesson_completed']},
};

export function isAnalyticsMetric(value:string|null): value is AnalyticsMetricKey {
  return value!==null && Object.hasOwn(METRICS,value);
}

export function analyticsMetricInfo(metric:AnalyticsMetricKey){
  const {label,definition,formula}=METRICS[metric];
  return {label,definition,formula};
}

export async function readAnalyticsMetricEvents(db:D1Database,input:{userId:string;metric:AnalyticsMetricKey;from:string;to:string;limit?:number}) {
  const config=METRICS[input.metric];
  const limit=Math.max(1,Math.min(100,Math.floor(input.limit||100)));
  const placeholders=config.eventTypes.map((_,index)=>`?${index+4}`).join(',');
  const bindings=[input.userId,input.from,input.to,...config.eventTypes,limit];
  const result=await db.prepare(`SELECT e.id,e.event_type,e.platform,e.event_date,e.occurred_at,
      c.name AS chat_name,l.name AS lead_name,ls.subject AS lesson_subject
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
    LEFT JOIN lessons ls ON ls.id=e.lesson_id AND ls.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
      AND e.event_type IN (${placeholders})
    ORDER BY e.event_date DESC,e.occurred_at DESC,e.id DESC
    LIMIT ?${config.eventTypes.length+4}`).bind(...bindings).all<{
      id:string;event_type:string;platform:string|null;event_date:string;occurred_at:number;
      chat_name:string|null;lead_name:string|null;lesson_subject:string|null;
    }>();
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM activity_events
    WHERE user_id=?1 AND event_date>=?2 AND event_date<=?3 AND cancelled_at IS NULL
      AND event_type IN (${placeholders})`).bind(input.userId,input.from,input.to,...config.eventTypes).first<{count:number}>();
  return {
    total:Number(count?.count||0),
    events:result.results.map(row=>({
      id:row.id,eventType:row.event_type,platform:row.platform,eventDate:row.event_date,occurredAt:Number(row.occurred_at),
      chatName:row.chat_name,leadName:row.lead_name,lessonSubject:row.lesson_subject,
    })) as AnalyticsMetricEvent[],
  };
}
