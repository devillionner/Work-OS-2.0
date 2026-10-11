'use client';

import { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { FocusCard } from '@/components/views/today/focus-card';
import { KpiStrip } from '@/components/views/today/kpi-strip';
import { LeadQueue } from '@/components/views/today/lead-queue';
import { PlatformBreakdown } from '@/components/views/today/platform-breakdown';
import { ScheduleTimeline } from '@/components/views/today/schedule-timeline';
import { TimersCard } from '@/components/views/today/timers-card';
import { WorkdayPanel } from '@/components/views/today/workday-panel';
import { dateLabel, firstName, greeting } from '@/components/views/shared/pace';
import { GoalsPanel } from '@/components/views/shared/goals-panel';

/** «Сьогодні»: bento-сітка з 12 колонок. Усі дані — зі знімка дашборда, окремих запитів немає, крім розкладу Telegram. */
export default function TodayView() {
  const { user } = useShell();
  const [goalsOpen, setGoalsOpen] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 pb-6 @4xl:gap-4">
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
        <div className="@4xl:col-span-8"><WorkdayPanel greeting={`${greeting()}, ${firstName(user.displayName)}`} dateLabel={dateLabel()} /></div>
        <div className="@4xl:col-span-4"><TimersCard /></div>
      </div>
      <KpiStrip />
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
        <div className="@4xl:col-span-4"><FocusCard onOpenGoals={() => setGoalsOpen(true)} /></div>
        <div className="@4xl:col-span-8"><LeadQueue /></div>
      </div>
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-12 @4xl:gap-4">
        <div className="@4xl:col-span-4"><PlatformBreakdown /></div>
        <div className="@4xl:col-span-8"><ScheduleTimeline /></div>
      </div>
      <GoalsPanel open={goalsOpen} onOpenChange={setGoalsOpen} />
    </div>
  );
}
