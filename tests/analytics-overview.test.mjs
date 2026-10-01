import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAnalyticsOverview } from '../lib/analytics-overview.ts';
import { readMonthlyGoalProgress } from '../lib/goals.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const recommendation={kind:'insufficient_data',title:'Поки недостатньо даних для рекомендації',explanation:'sample',chatId:null,chatName:null};

void test('analytics overview exposes selected range, plan fact, equal-period change and largest target gap',()=>{
  const overview=buildAnalyticsOverview({
    range:{from:'2026-09-01',to:'2026-09-24',days:24},
    totals:{joined:100,publications:60,responses:12,bookings:6,completed:3,publicationRate:60,responseRate:20,bookingRate:50,completionRate:50},
    targets:{publicationRate:70,responseRate:25,bookingRate:40,completionRate:80},
    monthlyGoal:{target:20,actual:6},previousBookings:4,recommendation,
  });
  assert.deepEqual(overview.range,{from:'2026-09-01',to:'2026-09-24',days:24});
  assert.deepEqual(overview.monthlyGoal,{target:20,actual:6,remaining:14,progress:30});
  assert.equal(overview.comparison.delta,2);
  assert.match(overview.comparison.label,/на 2 більше/);
  assert.deepEqual(overview.bottleneck,{key:'completionRate',label:'Проведені від записів',actual:50,target:80,gap:30});
});

void test('analytics overview does not invent a bottleneck without configured misses',()=>{
  const overview=buildAnalyticsOverview({
    range:{from:'2026-09-24',to:'2026-09-24',days:1},
    totals:{joined:0,publications:0,responses:0,bookings:0,completed:0,publicationRate:0,responseRate:0,bookingRate:0,completionRate:0},
    targets:{publicationRate:0,responseRate:0,bookingRate:0,completionRate:0},
    monthlyGoal:{target:0,actual:0},previousBookings:0,recommendation,
  });
  assert.equal(overview.bottleneck,null);
  assert.equal(overview.monthlyGoal.progress,0);
  assert.match(overview.comparison.label,/без змін/);
});

void test('monthly overview fact stops at the selected range end date',async t=>{
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO goal_versions(id,user_id,goal_key,effective_on,value,created_at,source,version)
    VALUES ('monthly','u','monthly_booking_goal','2026-09-01',20,1,'manual',1)`).run();
  await seedEvent(db,{id:'before',type:'lesson_booked',date:'2026-09-10',at:1});
  await seedEvent(db,{id:'after',type:'lesson_booked',date:'2026-09-20',at:2});
  assert.deepEqual(await readMonthlyGoalProgress(db,'u','2026-09-15'),{target:20,actual:1});
  assert.deepEqual(await readMonthlyGoalProgress(db,'u','2026-09-30'),{target:20,actual:2});
});

void test('overview route and Analytics UI use the exact selected query without stale cross-view data',()=>{
  const route=readFileSync(new URL('../app/api/analytics/overview/route.ts',import.meta.url),'utf8');
  const workspace=readFileSync(new URL('../components/analytics-workspace.tsx',import.meta.url),'utf8');
  const insights=readFileSync(new URL('../components/analytics-insights.tsx',import.meta.url),'utf8');
  assert.match(route,/resolveAnalyticsRange\(new URL\(request\.url\)\.searchParams,today\)/);
  assert.match(route,/readMonthlyGoalProgress\(env\.DB,user\.id,to\)/);
  assert.match(route,/activitySummaryStatement\(env\.DB,user\.id,from,to\)/);
  assert.match(route,/previousStart=shiftBusinessDate\(previousEnd,-\(days-1\)\)/);
  assert.match(route,/buildAnalyticsOverview\(\{range:\{from,to,days\}/);
  assert.match(workspace,/const queryKey=useMemo/);
  assert.match(workspace,/viewCache=useRef\(new Map<string,AnalyticsData>\(\)\)/);
  assert.match(workspace,/loadedData\?\.key===queryKey\?loadedData\.data:viewCache\.current\.get\(queryKey\)\|\|null/);
  assert.match(workspace,/<AnalyticsInsights insights=\{data\.insights\} query=\{queryKey\} \/>/);
  assert.match(insights,/loaded\?\.query===query\?loaded\.data:cache\.current\.get\(query\)\|\|null/);
  assert.match(insights,/fetch\(`\/api\/analytics\/overview\?\$\{query\}`/);
  assert.match(insights,/return\(\)=>controller\.abort\(\)/);
});
