'use client';

import { Ellipsis, Pause, Play, RotateCcw, Square, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Surface } from '@/components/ui/surface';
import { dateLabel, firstName, greeting } from '@/components/views/shared/pace';
import { nowSeconds } from '@/components/views/today/clock';
import { useSecondClock } from '@/components/views/today/use-second-clock';
import type { WorkdayState } from '@/components/views/today/use-workday';
import { cn } from '@/lib/utils';
import type { WorkdaySnapshot } from '@/lib/workday';

/** Активний час `Г:ХХ:СС`; тікає щосекунди лише поки день триває. */
export function ActiveTime({ workday }: { workday: WorkdaySnapshot | null }) {
  const now = useSecondClock(workday?.status === 'active');
  const seconds = workday ? workday.activeSeconds + (workday.status === 'active' ? Math.max(0, now - workday.asOf) : 0) : 0;
  const total = Math.max(0, Math.floor(seconds));
  return <>{`${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`}</>;
}

function formatTime(value: number | null) {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000));
}
function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Картка дня: дата, привітання, активний час, стан і кнопки за станом дня («Почати день» → «Пауза» → «Продовжити», тихе
 * «Завершити»); решта («План дня», «Повернути», «Скинути») — в меню «⋯». Завершення з незавершеними справами й скидання
 * просять підтвердження.
 */
export function DayCard({ state, size, earlierPauseMinutes, onOpenGoals }: { state: WorkdayState; size: 'phone' | 'desktop'; earlierPauseMinutes: number; onOpenGoals: () => void }) {
  const { user, snapshot } = useShell();
  const { workday, currentToday, busy, error, confirmCount, setConfirmCount, mutate } = state;
  const [resetOpen, setResetOpen] = useState(false);
  const staleOpen = Boolean(workday && workday.status !== 'ended' && workday.workDate !== currentToday);
  const showPlan = !workday || workday.workDate === currentToday;
  const plan = workday?.plan ?? { dailyGoal: snapshot.bookingGoal.target, monthlyGoal: snapshot.monthlyBookingGoal, focusDirections: snapshot.focusDirections, createdAt: 0 };
  const canReset = workday?.status === 'ended' && workday.workDate === currentToday;
  const pauseNote = earlierPauseMinutes > 0 ? ` · пауз раніше ${earlierPauseMinutes} хв` : '';
  const statusText = !workday ? 'Готово до старту' : workday.status === 'active' ? `Триває з ${formatTime(workday.startedAt)}${pauseNote}` : workday.status === 'paused' ? `Пауза з ${formatTime(workday.pausedAt)}${pauseNote}` : `Завершено о ${formatTime(workday.endedAt)}`;
  const dot = `size-2 shrink-0 rounded-full ${workday?.status === 'active' ? 'bg-ok' : workday?.status === 'paused' ? 'bg-warn' : 'bg-line-strong'}`;

  const wide = size === 'desktop' ? 'px-4 text-sm' : 'px-[22px] text-sm';
  const main = !workday
    ? <Button variant="action" size="lg" busy={busy} onClick={() => void mutate('start')} className={wide}><Play aria-hidden="true" strokeWidth={1.5} />Почати день</Button>
    : workday.status === 'active'
      ? <Button variant="outline" size="lg" busy={busy} onClick={() => void mutate('pause')} className={wide}><Pause aria-hidden="true" strokeWidth={1.5} />Пауза</Button>
      : workday.status === 'paused'
        ? <Button variant="action" size="lg" busy={busy} onClick={() => void mutate('resume')} className={wide}><Play aria-hidden="true" strokeWidth={1.5} />Продовжити</Button>
        : null;

  return (
    <Surface variant="glass" radius="card" data-reveal className={cn('min-w-0', size === 'phone' ? 'p-3.5' : 'p-5')} aria-labelledby="workday-title">
      <p className="m-0 text-[13px] text-ink-2">{dateLabel(new Date(nowSeconds() * 1000))}</p>
      <h2 id="workday-title" className="m-0 mt-1 text-xl font-medium leading-[1.3] tracking-[-0.02em]">{`${greeting(new Date(nowSeconds() * 1000))}, ${firstName(user.displayName)}`}</h2>
      <p className="m-0 mt-2.5 font-mono text-4xl font-normal leading-none tracking-[-0.03em] tabular-nums" aria-live="off"><ActiveTime workday={workday} /></p>
      <p className="m-0 mt-1.5 flex items-center gap-2 pb-1 text-sm text-ink-2" aria-live="polite"><i aria-hidden="true" className={dot} />{statusText}</p>

      <div className={cn('mt-3.5 flex flex-wrap items-center', size === 'phone' ? 'gap-2.5' : 'gap-2')}>
        {confirmCount !== null ? (
          <>
            <Button variant="action" size="lg" busy={busy} onClick={() => void mutate('end', true)}>Завершити попри {confirmCount}</Button>
            <Button variant="outline" size="lg" disabled={busy} onClick={() => setConfirmCount(null)}>Не завершувати</Button>
          </>
        ) : (
          <>
            {main}
            {workday && workday.status !== 'ended' ? <Button variant="ghost" size="lg" busy={busy} onClick={() => void mutate('end')} className={wide}><Square aria-hidden="true" strokeWidth={1.5} />Завершити</Button> : null}
          </>
        )}
        <Menu>
          <MenuTrigger render={<Button variant="icon" size="lg" aria-label="Ще дії робочого дня" className={size === 'desktop' ? 'size-11' : ''} />}><Ellipsis aria-hidden="true" strokeWidth={1.5} /></MenuTrigger>
          <MenuContent align="start" className="max-w-72">
            <MenuItem onClick={onOpenGoals}><Target aria-hidden="true" strokeWidth={1.5} />План дня: цілі й напрямки</MenuItem>
            {showPlan && workday?.plan ? <MenuLabel>Зафіксовано о {formatTime(workday.plan.createdAt)}: записи {plan.dailyGoal}, місяць {plan.monthlyGoal}, {plan.focusDirections.length ? plan.focusDirections.join(', ') : 'усі напрямки'}</MenuLabel> : null}
            {workday?.status === 'ended' ? <MenuItem onClick={() => void mutate('reopen')}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Повернути день</MenuItem> : null}
            {canReset ? (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => setResetOpen(true)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Скинути день</MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>

      {staleOpen ? <output className="mt-3 block rounded-inner border border-warn/40 px-4 py-3 text-sm">Відкритий день за {formatDate(workday!.workDate)}. Заверши його перед стартом нового.</output> : null}
      {confirmCount !== null ? <output className="mt-2.5 block text-[13px] text-warn">Залишилося справ: {confirmCount}. Завершити день попри це?</output> : null}
      {error ? <p role="alert" className="m-0 mt-2.5 text-sm text-hot">{error}</p> : null}

      <ConfirmDialog
        open={resetOpen}
        title="Скинути робочий день?"
        description="Активний час і запис робочого дня за сьогодні буде видалено, після цього день можна почати заново. Ліди, чати, уроки та звіти не видаляються. Цю дію не можна скасувати."
        confirmLabel="Скинути день"
        busy={busy}
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void mutate('reset').then((ok) => { if (ok) setResetOpen(false); })}
      />
    </Surface>
  );
}
