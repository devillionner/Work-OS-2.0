'use client';

import { useRef, useState } from 'react';
import { DESKTOP, useMediaQuery } from '@/components/shell/use-media';
import { GoalsPanel } from '@/components/views/shared/goals-panel';
import { CenteredTimeline } from '@/components/views/today/centered-timeline';
import { DayCard } from '@/components/views/today/day-card';
import { HatchDefs } from '@/components/views/today/event-parts';
import { GoalsCard } from '@/components/views/today/goals-card';
import { HourTimeline } from '@/components/views/today/hour-timeline';
import { KpiPanel, type Metric } from '@/components/views/today/kpi-panel';
import { StatusCard } from '@/components/views/today/status-card';
import { useDay } from '@/components/views/today/use-day';
import { useFillHeight } from '@/components/views/today/use-fill-height';

/**
 * «Сьогодні». ПК (від 1024 px): «Зараз у центрі»: ліворуч заголовок-відлік і вікно шкали дня 08:00–21:00 з лінією «зараз»
 * посередині, праворуч привітання з таймером, кільця цілей 2×2 і статуси. Телефон і планшет: картки одна під одною (привітання,
 * «Цілі дня», статуси, «День за годинами») з однією прокруткою сторінки. Дані з наявних джерел: знімок дашборда, розклад
 * Telegram, проміжні й денні звіти; нових періодичних запитів немає.
 */
export default function TodayView() {
  const desktop = useMediaQuery(DESKTOP);
  const day = useDay();
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [metric, setMetric] = useState<Metric | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useFillHeight(root, desktop);
  const size = desktop ? 'desktop' : 'phone';
  const cards = (
    <>
      <DayCard state={day.workday} size={size} earlierPauseMinutes={day.model.earlierPauseMinutes} onOpenGoals={() => setGoalsOpen(true)} />
      <GoalsCard goals={day.goals} size={size} onBreakdown={() => setMetric('publications')} />
      <StatusCard statuses={day.statuses} size={size} />
    </>
  );

  return (
    <>
      <HatchDefs />
      {desktop ? (
        <div ref={root} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(300px,340px)] gap-4">
          <CenteredTimeline day={day} />
          <div className="hide-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto">{cards}</div>
        </div>
      ) : (
        <div ref={root} className="mx-auto flex w-full max-w-[720px] flex-col gap-3 pb-6">
          {cards}
          <HourTimeline day={day} />
        </div>
      )}
      <KpiPanel metric={metric} onMetricChange={setMetric} onClose={() => setMetric(null)} />
      <GoalsPanel open={goalsOpen} onOpenChange={setGoalsOpen} />
    </>
  );
}
