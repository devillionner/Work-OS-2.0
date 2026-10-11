'use client';

import { Plus } from 'lucide-react';
import { emitCommand } from '@/components/shell/command-bus';
import { TimerRow } from '@/components/shell/timers';
import { dismissTimer, splitTimers, useTimers } from '@/components/shell/timers-store';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Surface } from '@/components/ui/surface';

/** Таймери праворуч від робочого дня: ті самі дані, що в Topbar, без другого запиту. */
export function TimersCard() {
  const { timers, now } = useTimers();
  const { running, completed } = splitTimers(timers, now);
  const visible = [...completed, ...running].slice(0, 3);
  return (
    <Surface variant="glass" radius="card" spot data-reveal className="flex h-full flex-col gap-4 p-5 sm:p-6" aria-labelledby="timers-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="timers-title" className="m-0 text-[17px] font-medium">Таймери</h2>
        <Button variant="outline" size="sm" onClick={() => emitCommand('timers:open')}><Plus aria-hidden="true" strokeWidth={1.5} />Запустити</Button>
      </div>
      {visible.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {visible.map((timer) => <TimerRow key={timer.id} timer={timer} now={now} completed={completed.includes(timer)} onDismiss={() => void dismissTimer(timer.id)} />)}
        </ul>
      ) : (
        <EmptyState text="Активних таймерів немає. Запусти таймер для перерви між публікаціями." />
      )}
    </Surface>
  );
}
