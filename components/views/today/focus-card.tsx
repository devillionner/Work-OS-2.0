'use client';

import { ArrowRight, Play } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { goalRatio } from '@/components/views/shared/pace';
import type { WorkdayStatus } from '@/components/views/today/workday-panel';

/** Інвертована картка «Фокус»: одна наступна дія, лічильник прострочених лідів і кнопка переходу. */
export function FocusCard({ onOpenGoals, workday, onStartDay }: { onOpenGoals: () => void; workday: WorkdayStatus | null; onStartDay: () => void }) {
  const { snapshot, navigate, openLead } = useShell();
  const next = snapshot.leadTasks[0];
  const publication = snapshot.publicationGoal;
  const remaining = Math.max(0, publication.target - publication.completed);

  // До першого знімка від панелі дня стан береться зі знімка «Сьогодні».
  const started = workday ? workday.started : Boolean(snapshot.workday);
  const busy = workday?.busy ?? false;

  const action = !started
    ? { text: 'Почни робочий день, щоб зафіксувати цілі й запустити відлік часу.', label: 'Почати день', run: onStartDay, start: true }
    : next
      ? { text: `${next.title} — ${next.leadName}`, label: 'Відкрити ліда', run: () => openLead(next.leadId), start: false }
      : remaining > 0
        ? { text: `До цілі публікацій лишилось ${remaining}.`, label: 'Почати постинг', run: () => navigate('platforms'), start: false }
        : { text: 'Ціль публікацій виконано. Перевір відгуки й нових лідів.', label: 'Відкрити лідів', run: () => navigate('leads'), start: false };

  return (
    <Surface variant="inverted" radius="card" data-reveal className="flex flex-col justify-between gap-8 p-6" aria-labelledby="focus-title">
      <div className="flex flex-col gap-3">
        <h2 id="focus-title" className="m-0 text-[13px] font-normal opacity-60">Фокус</h2>
        <p className="m-0 text-[22px] font-normal leading-snug tracking-[-0.02em]">{action.text}</p>
      </div>
      <div className="flex flex-col gap-4">
        <dl className="m-0 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs opacity-60">Прострочено</dt><dd className="m-0 mt-1 font-mono text-[28px] leading-none">{snapshot.leadTaskCount}</dd></div>
          <div><dt className="text-xs opacity-60">Чатів</dt><dd className="m-0 mt-1 font-mono text-[28px] leading-none">{snapshot.chats}</dd></div>
          <div><dt className="text-xs opacity-60">Лідів</dt><dd className="m-0 mt-1 font-mono text-[28px] leading-none">{snapshot.leads}</dd></div>
        </dl>
        <p className="m-0 text-xs opacity-60">
          Фокус: {snapshot.focusDirections.length ? snapshot.focusDirections.join(', ') : 'усі напрямки'}
          {publication.target > 0 ? ` · публікації ${Math.round(goalRatio(publication.completed, publication.target) * 100)}%` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="action" size="lg" className="bg-action-ink text-action" busy={action.start && busy} onClick={action.run}>{action.start ? <Play aria-hidden="true" strokeWidth={1.5} /> : null}{action.label}{action.start ? null : <ArrowRight aria-hidden="true" strokeWidth={1.5} />}</Button>
          <Button variant="ghost" size="lg" className="text-inherit hover:bg-action-ink/10 hover:text-inherit" onClick={onOpenGoals}>Цілі й напрямки</Button>
        </div>
      </div>
    </Surface>
  );
}
