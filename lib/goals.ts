import { activitySummaryStatement, activityTotals, type ActivitySummaryRow } from './activity-summary.ts';
import { cachedAnalytics, readAnalyticsRangeVersion } from './analytics-cache.ts';
import { businessDate } from './business-time.ts';

export type GoalPlanFact = {
  dailyTarget: number;
  dailyActual: number;
  monthlyTarget: number;
  monthlyActual: number;
};

type GoalRow = { value:number };

export const GOAL_RESTORE_VERSION_BASE = 1_000_000;

/**
 * Підсумок подій за період (як у аналітиці) з кешу за версією подій періоду: місячний підсумок читають і «Звіти», і «Аналітика»,
 * а події місяця змінюються рідше, ніж будь-який запис у застосунку (див. analytics-cache.ts).
 */
async function periodSummary(db:D1Database,userId:string,from:string,to:string):Promise<ActivitySummaryRow[]> {
  const version=await readAnalyticsRangeVersion(db,userId,from,to,businessDate(Math.floor(Date.now()/1000)));
  return cachedAnalytics({
    userId,namespace:'period-summary',key:`${from}:${to}`,version,ttlSeconds:300,
    compute:async()=>(await activitySummaryStatement(db,userId,from,to).all<ActivitySummaryRow>()).results,
  });
}

export async function readMonthlyGoalProgress(db:D1Database,userId:string,date:string):Promise<{target:number;actual:number}> {
  const monthStart=`${date.slice(0,7)}-01`;
  const [target,events]=await Promise.all([
    readGoal(db,userId,'monthly_booking_goal',monthStart),
    periodSummary(db,userId,monthStart,date),
  ]);
  return {target,actual:activityTotals(events).bookings};
}

export async function readGoalPlanFact(db:D1Database,userId:string,date:string):Promise<GoalPlanFact> {
  const monthStart=`${date.slice(0,7)}-01`;
  const monthEnd=endOfMonth(date);
  const [dailyGoal,monthlyGoal,dailyEvents,monthlyEvents]=await Promise.all([
    readGoal(db,userId,'daily_booking_goal',date),
    readGoal(db,userId,'monthly_booking_goal',monthStart),
    activitySummaryStatement(db,userId,date,date).all<ActivitySummaryRow>(),
    periodSummary(db,userId,monthStart,monthEnd),
  ]);
  return {
    dailyTarget:dailyGoal,
    dailyActual:activityTotals(dailyEvents.results).bookings,
    monthlyTarget:monthlyGoal,
    monthlyActual:activityTotals(monthlyEvents).bookings,
  };
}

async function readGoal(db:D1Database,userId:string,key:string,effectiveOn:string):Promise<number> {
  const row=await db.prepare(`SELECT value FROM goal_versions
    WHERE user_id=?1 AND goal_key=?2 AND effective_on<=?3
    ORDER BY effective_on DESC,created_at DESC,version DESC LIMIT 1`).bind(userId,key,effectiveOn).first<GoalRow>();
  if(row) return Number(row.value||0);
  return key==='daily_booking_goal' ? 5 : 100;
}
function endOfMonth(value:string):string {
  const [year,month]=value.slice(0,7).split('-').map(Number);
  return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
}

export type GoalKey = 'daily_booking_goal' | 'monthly_booking_goal';

export function goalVersionStatement(db:D1Database,args:{
  userId:string; key:GoalKey; value:number; now:number; today:string;
}) {
  const effectiveOn=args.key==='monthly_booking_goal' ? `${args.today.slice(0,7)}-01` : args.today;
  return db.prepare(`INSERT INTO goal_versions(id,user_id,goal_key,effective_on,value,created_at,source,version)
    SELECT ?1,?2,?3,?4,?5,?6,'manual',COALESCE(MAX(CASE WHEN version<?7 THEN version END),0)+1
    FROM goal_versions WHERE user_id=?2 AND goal_key=?3`)
    .bind(`goal_${crypto.randomUUID()}`,args.userId,args.key,effectiveOn,args.value,args.now,GOAL_RESTORE_VERSION_BASE);
}
