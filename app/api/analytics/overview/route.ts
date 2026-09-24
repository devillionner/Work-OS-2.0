import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { activitySummaryStatement, activityTotals, type ActivitySummaryRow } from '@/lib/activity-summary';
import { buildAnalyticsOverview } from '@/lib/analytics-overview';
import { buildAnalyticsRecommendation } from '@/lib/analytics-insights';
import { readMonthlyGoalProgress } from '@/lib/goals';
import { shiftBusinessDate } from '@/lib/business-time';

export async function GET():Promise<Response> {
  const user=await getCurrentUser();
  if(!user)return Response.json({error:'Потрібно увійти.'},{status:401});
  const today=kyivDate();
  const monthStart=`${today.slice(0,7)}-01`;
  const elapsedDays=Number(today.slice(8,10));
  const previousEnd=shiftBusinessDate(monthStart,-1);
  const previousStart=`${previousEnd.slice(0,7)}-01`;
  const previousComparableEnd=shiftBusinessDate(previousStart,Math.min(elapsedDays-1,Number(previousEnd.slice(8,10))-1));

  const [monthlyGoal,currentEvents,previousEvents,targetResult,chatResult]=await Promise.all([
    readMonthlyGoalProgress(env.DB,user.id,today),
    activitySummaryStatement(env.DB,user.id,monthStart,today).all<ActivitySummaryRow>(),
    activitySummaryStatement(env.DB,user.id,previousStart,previousComparableEnd).all<ActivitySummaryRow>(),
    env.DB.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('target_publication_rate','target_response_rate','target_booking_rate','target_completion_rate')`).bind(user.id).all<{setting_key:string;value_json:string}>(),
    env.DB.prepare(`SELECT COALESCE(e.chat_id,l.source_chat_id) AS id,COALESCE(c.name,'Без назви') AS name,COALESCE(c.platform,'unknown') AS platform,COALESCE(c.workflow_status,'unknown') AS status,
      SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
      SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses
      FROM activity_events e LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
      WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL AND COALESCE(e.chat_id,l.source_chat_id) IS NOT NULL
      GROUP BY COALESCE(e.chat_id,l.source_chat_id),c.name,c.platform,c.workflow_status HAVING publications>0 OR responses>0 LIMIT 100`).bind(user.id,monthStart,today).all<{id:string;name:string;platform:string;status:string;publications:number;responses:number}>(),
  ]);
  const current=activityTotals(currentEvents.results);
  const previous=activityTotals(previousEvents.results);
  const completed=countEvent(currentEvents.results,'lesson_completed');
  const totals={
    joined:current.joined,publications:current.publications,responses:current.responses,bookings:current.bookings,completed,
    publicationRate:rate(current.publications,current.joined),responseRate:rate(current.responses,current.publications),bookingRate:rate(current.bookings,current.responses),completionRate:rate(completed,current.bookings),
  };
  const targetMap=new Map(targetResult.results.map(row=>[row.setting_key,settingPercent(row.value_json)]));
  const targets={publicationRate:targetMap.get('target_publication_rate')||0,responseRate:targetMap.get('target_response_rate')||0,bookingRate:targetMap.get('target_booking_rate')||0,completionRate:targetMap.get('target_completion_rate')||0};
  const chats=chatResult.results.map(row=>({...row,publications:Number(row.publications||0),responses:Number(row.responses||0),responseRate:rate(Number(row.responses||0),Number(row.publications||0))}));
  const recommendation=buildAnalyticsRecommendation(chats,elapsedDays);
  return Response.json(buildAnalyticsOverview({totals,targets,monthlyGoal,previousBookings:previous.bookings,recommendation}),{headers:{'Cache-Control':'no-store'}});
}

function countEvent(rows:ActivitySummaryRow[],eventType:string):number{return rows.filter(row=>row.event_type===eventType).reduce((sum,row)=>sum+Number(row.count||0),0);}
function rate(value:number,base:number):number{return base>0?Math.round((value/base)*1000)/10:0;}
function settingPercent(value:string):number{try{const parsed=JSON.parse(value);return Number.isInteger(parsed)&&parsed>=0&&parsed<=100?parsed:0;}catch{return 0;}}
function kyivDate():string{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;}
