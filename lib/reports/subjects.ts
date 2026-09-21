import { shiftBusinessDate } from '../business-time.ts';
import { canonicalSubject } from '../subjects.ts';

export { canonicalSubject } from '../subjects.ts';

export const SUBJECT_PERIODS = ['day', '7', '30', 'month', 'all'] as const;
export type SubjectPeriod = (typeof SUBJECT_PERIODS)[number];
export type SubjectAnalyticsRow = { subject:string; responses:number; bookings:number; conversion:number; responseShare:number; bookingShare:number };
export type SubjectAnalytics = { period:SubjectPeriod; from:string|null; to:string; rows:SubjectAnalyticsRow[]; total:SubjectAnalyticsRow };
type AggregateRow = { event_type:string; subject:string|null; count:number };

export type SubjectAnalyticsRange = { from:string; to:string; rows:SubjectAnalyticsRow[]; total:SubjectAnalyticsRow };

export async function readSubjectAnalyticsRange(db:D1Database,userId:string,from:string,to:string):Promise<SubjectAnalyticsRange> {
  const result=await db.prepare(`SELECT e.event_type,
      CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END AS subject,
      COUNT(*) AS count
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN lessons ls ON ls.id=e.lesson_id AND ls.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
      AND e.event_type IN ('lead_created','lesson_booked','curator_booking_pending')
    GROUP BY e.event_type,CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END`)
    .bind(userId,from,to).all<AggregateRow>();
  const aggregated=aggregateRows(result.results,'day',from,to);
  return {from,to,rows:aggregated.rows,total:aggregated.total};
}

export async function readSubjectAnalytics(db:D1Database,userId:string,date:string,period:SubjectPeriod):Promise<SubjectAnalytics> {
  const range=subjectRange(date,period);
  const fromFilter=range.from?'AND e.event_date>=?3':'';
  const result=await db.prepare(`SELECT e.event_type,
      CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END AS subject,
      COUNT(*) AS count
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN lessons ls ON ls.id=e.lesson_id AND ls.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date<=?2 ${fromFilter} AND e.cancelled_at IS NULL
      AND e.event_type IN ('lead_created','lesson_booked','curator_booking_pending')
    GROUP BY e.event_type,CASE WHEN e.event_type='lead_created' THEN l.subject ELSE COALESCE(NULLIF(ls.subject,''),l.subject) END`)
    .bind(userId,range.to,...(range.from?[range.from]:[])).all<AggregateRow>();
  return aggregateRows(result.results,period,range.from,range.to);
}

function aggregateRows(rows:AggregateRow[],period:SubjectPeriod,from:string|null,to:string):SubjectAnalytics {
  const grouped=new Map<string,{responses:number;bookings:number}>();
  for(const row of rows){const subject=canonicalSubject(row.subject);const current=grouped.get(subject)||{responses:0,bookings:0};if(row.event_type==='lead_created')current.responses+=Number(row.count||0);else current.bookings+=Number(row.count||0);grouped.set(subject,current);}
  const responseTotal=[...grouped.values()].reduce((sum,row)=>sum+row.responses,0);
  const bookingTotal=[...grouped.values()].reduce((sum,row)=>sum+row.bookings,0);
  const rowsOut=[...grouped].map(([subject,values])=>({subject,...values,conversion:percent(values.bookings,values.responses),responseShare:percent(values.responses,responseTotal),bookingShare:percent(values.bookings,bookingTotal)})).sort((a,b)=>b.bookings-a.bookings||b.responses-a.responses||a.subject.localeCompare(b.subject,'uk'));
  return {period,from,to,rows:rowsOut,total:{subject:'\u0423\u0441\u044c\u043e\u0433\u043e',responses:responseTotal,bookings:bookingTotal,conversion:percent(bookingTotal,responseTotal),responseShare:responseTotal?100:0,bookingShare:bookingTotal?100:0}};
}

export function subjectRange(date:string,period:SubjectPeriod){if(period==='day')return{from:date,to:date};if(period==='7')return{from:shiftBusinessDate(date,-6),to:date};if(period==='30')return{from:shiftBusinessDate(date,-29),to:date};if(period==='all')return{from:null,to:date};const monthStart=`${date.slice(0,7)}-01`;const nextMonth=new Date(`${monthStart}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);return{from:monthStart,to:shiftBusinessDate(nextMonth.toISOString().slice(0,10),-1)};}

function percent(value:number,base:number){return base>0?Math.round((value/base)*1000)/10:0;}
