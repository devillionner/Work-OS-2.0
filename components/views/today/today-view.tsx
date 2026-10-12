'use client';

import { useRef, useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { KpiStrip } from '@/components/views/today/kpi-strip';
import { NowList } from '@/components/views/today/now-list';
import { ScheduleCard } from '@/components/views/today/schedule-card';
import { WorkdayPanel, type WorkdayStatus } from '@/components/views/today/workday-panel';
import { dateLabel, firstName, greeting } from '@/components/views/shared/pace';
import { GoalsPanel } from '@/components/views/shared/goals-panel';
import { cn } from '@/lib/utils';

/**
 * «Сьогодні»: спершу дія, потім декор. Шапка дня одним рядком, стрічка KPI, а під нею «Що зробити зараз» і розклад Telegram
 * поруч (на телефоні — шапка, «Що зробити зараз», KPI 2×2, розклад). Усі дані — зі знімка дашборда, окремих запитів немає,
 * крім розкладу Telegram.
 */
export default function TodayView() {
  const { user, snapshot } = useShell();
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [workday, setWorkday] = useState<WorkdayStatus | null>(null);
  const startDay = useRef<(() => void) | null>(null);
  const schedule = snapshot.enabledPlatforms.includes('telegram');
  return (
    <div className="mx-auto grid w-full max-w-[1360px] grid-cols-1 gap-3 pb-6 @4xl:grid-cols-12 @4xl:gap-4">
      <div className="order-1 @4xl:col-span-12"><WorkdayPanel greeting={`${greeting()}, ${firstName(user.displayName)}`} dateLabel={dateLabel()} startRef={startDay} onStatusChange={setWorkday} onOpenGoals={() => setGoalsOpen(true)} /></div>
      <div className="order-3 @4xl:order-2 @4xl:col-span-12"><KpiStrip /></div>
      <div className={cn('order-2 @4xl:order-3 @4xl:col-span-12', schedule && '@4xl:col-span-7')}><NowList workday={workday} onStartDay={() => startDay.current?.()} /></div>
      {schedule ? <div className="order-4 @4xl:col-span-5"><ScheduleCard /></div> : null}
      <GoalsPanel open={goalsOpen} onOpenChange={setGoalsOpen} />
    </div>
  );
}
