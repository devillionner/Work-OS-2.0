import type { AnalyticsRecommendation } from './analytics-insights.ts';

export type AnalyticsOverviewTotals = {
  joined: number;
  publications: number;
  responses: number;
  bookings: number;
  completed: number;
  publicationRate: number;
  responseRate: number;
  bookingRate: number;
  completionRate: number;
};

export type AnalyticsOverviewTargets = {
  publicationRate: number;
  responseRate: number;
  bookingRate: number;
  completionRate: number;
};

export type AnalyticsOverview = {
  monthlyGoal: {
    target: number;
    actual: number;
    remaining: number;
    progress: number;
  };
  comparison: {
    bookings: number;
    previousBookings: number;
    delta: number;
    label: string;
  };
  bottleneck: {
    key: keyof AnalyticsOverviewTargets;
    label: string;
    actual: number;
    target: number;
    gap: number;
  } | null;
  recommendation: AnalyticsRecommendation;
};

const stages: Array<{ key:keyof AnalyticsOverviewTargets; label:string }> = [
  { key:'publicationRate', label:'Публікації → приєднані' },
  { key:'responseRate', label:'Відгуки → публікації' },
  { key:'bookingRate', label:'Записи → відгуки' },
  { key:'completionRate', label:'Проведені → записи' },
];

export function buildAnalyticsOverview(args:{
  totals: AnalyticsOverviewTotals;
  targets: AnalyticsOverviewTargets;
  monthlyGoal: { target:number; actual:number };
  previousBookings: number;
  recommendation: AnalyticsRecommendation;
}):AnalyticsOverview {
  const target=Math.max(0,Math.trunc(args.monthlyGoal.target));
  const actual=Math.max(0,Math.trunc(args.monthlyGoal.actual));
  const previousBookings=Math.max(0,Math.trunc(args.previousBookings));
  const bookings=Math.max(0,Math.trunc(args.totals.bookings));
  const delta=bookings-previousBookings;

  const bottleneck=stages
    .map((stage)=>{
      const targetRate=Math.max(0,args.targets[stage.key]||0);
      const actualRate=Math.max(0,args.totals[stage.key]||0);
      return {...stage,actual:actualRate,target:targetRate,gap:Math.round((targetRate-actualRate)*10)/10};
    })
    .filter((stage)=>stage.target>0&&stage.gap>0)
    .sort((a,b)=>b.gap-a.gap||a.label.localeCompare(b.label,'uk'))[0]||null;

  return {
    monthlyGoal:{
      target,
      actual,
      remaining:Math.max(0,target-actual),
      progress:target>0?Math.round((actual/target)*1000)/10:0,
    },
    comparison:{
      bookings,
      previousBookings,
      delta,
      label:comparisonLabel(bookings,previousBookings),
    },
    bottleneck:bottleneck?{
      key:bottleneck.key,
      label:bottleneck.label,
      actual:bottleneck.actual,
      target:bottleneck.target,
      gap:bottleneck.gap,
    }:null,
    recommendation:args.recommendation,
  };
}

function comparisonLabel(current:number,previous:number):string {
  if(current===previous)return `Записи без змін проти попереднього рівного періоду: ${current}.`;
  const difference=Math.abs(current-previous);
  return current>previous
    ? `Записів на ${difference} більше, ніж у попередньому рівному періоді (${previous} → ${current}).`
    : `Записів на ${difference} менше, ніж у попередньому рівному періоді (${previous} → ${current}).`;
}
