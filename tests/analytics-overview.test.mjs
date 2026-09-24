import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalyticsOverview } from '../lib/analytics-overview.ts';

const recommendation={kind:'insufficient_data',title:'Поки недостатньо даних для рекомендації',explanation:'sample',chatId:null,chatName:null};

void test('analytics overview exposes monthly plan fact, equal-period change and largest target gap',()=>{
  const overview=buildAnalyticsOverview({
    totals:{joined:100,publications:60,responses:12,bookings:6,completed:3,publicationRate:60,responseRate:20,bookingRate:50,completionRate:50},
    targets:{publicationRate:70,responseRate:25,bookingRate:40,completionRate:80},
    monthlyGoal:{target:20,actual:6},previousBookings:4,recommendation,
  });
  assert.deepEqual(overview.monthlyGoal,{target:20,actual:6,remaining:14,progress:30});
  assert.equal(overview.comparison.delta,2);
  assert.match(overview.comparison.label,/на 2 більше/);
  assert.deepEqual(overview.bottleneck,{key:'completionRate',label:'Проведені → записи',actual:50,target:80,gap:30});
});

void test('analytics overview does not invent a bottleneck without configured misses',()=>{
  const overview=buildAnalyticsOverview({
    totals:{joined:0,publications:0,responses:0,bookings:0,completed:0,publicationRate:0,responseRate:0,bookingRate:0,completionRate:0},
    targets:{publicationRate:0,responseRate:0,bookingRate:0,completionRate:0},
    monthlyGoal:{target:0,actual:0},previousBookings:0,recommendation,
  });
  assert.equal(overview.bottleneck,null);
  assert.equal(overview.monthlyGoal.progress,0);
  assert.match(overview.comparison.label,/без змін/);
});
