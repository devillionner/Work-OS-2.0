'use client';

import { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { KpiStrip } from '@/components/views/today/kpi-strip';
import { ScheduleCard } from '@/components/views/today/schedule-card';
import { WorkdayPanel } from '@/components/views/today/workday-panel';
import { dateLabel, firstName, greeting } from '@/components/views/shared/pace';
import { GoalsPanel } from '@/components/views/shared/goals-panel';

/**
 * «Сьогодні»: велика картка дня (привітання, активний час і кнопка ліворуч, «Нагадування» праворуч, рядок статусів унизу),
 * під нею плитки цілей і повний розклад Telegram. Дані — зі знімка дашборда; окремі запити лише в розкладу Telegram і в статусів
 * звітів (один `GET /api/reports`).
 */
export default function TodayView() {
  const { user } = useShell();
  const [goalsOpen, setGoalsOpen] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 pb-6 @4xl:gap-4">
      <WorkdayPanel greeting={`${greeting()}, ${firstName(user.displayName)}`} dateLabel={dateLabel()} onOpenGoals={() => setGoalsOpen(true)} />
      <KpiStrip />
      <ScheduleCard />
      <GoalsPanel open={goalsOpen} onOpenChange={setGoalsOpen} />
    </div>
  );
}
