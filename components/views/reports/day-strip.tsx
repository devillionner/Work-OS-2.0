'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { calendarContextLabels } from '@/lib/reports/calendar-labels';
import type { CalendarDayContext } from '@/lib/reports/calendar-context';
import { cn } from '@/lib/utils';
import { DAY_FILTERS, formatDate, formatMonth, matchesFilter, monthDates, weekday, type DayFilter, type Report } from './types';

function stateLabel(report: Report | undefined): string {
  if (!report) return 'звіту немає';
  if (report.stale) return 'звіт потребує оновлення';
  return report.submittedAt ? 'звіт здано' : 'є чернетка звіту';
}

/** Стрічка днів місяця зі scroll-snap: день — pill з числом і крапкою стану, місяць перемикається стрілками. */
export function DayStrip({ month, selected, today, reports, context, filter, onFilter, onSelect, onMonth, busy }: {
  month: string;
  selected: string;
  today: string;
  reports: Report[];
  context: CalendarDayContext[];
  filter: DayFilter;
  onFilter: (filter: DayFilter) => void;
  onSelect: (date: string) => void;
  onMonth: (offset: number) => void;
  busy: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const dates = useMemo(() => monthDates(month), [month]);
  const reportByDate = useMemo(() => new Map(reports.map((report) => [report.date, report])), [reports]);
  const contextByDate = useMemo(() => new Map(context.map((item) => [item.date, item])), [context]);

  useEffect(() => {
    const box = scroller.current;
    const node = box?.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    if (!box || !node) return;
    box.scrollTo({ left: node.offsetLeft - box.clientWidth / 2 + node.clientWidth / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [selected, month]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button variant="icon" size="sm" aria-label="Попередній місяць" disabled={busy} onClick={() => onMonth(-1)}><ChevronLeft aria-hidden="true" strokeWidth={1.5} /></Button>
          <h2 className="m-0 min-w-[8.5rem] text-center text-[17px] font-medium">{formatMonth(month)}</h2>
          <Button variant="icon" size="sm" aria-label="Наступний місяць" disabled={busy || month >= today.slice(0, 7)} onClick={() => onMonth(1)}><ChevronRight aria-hidden="true" strokeWidth={1.5} /></Button>
        </div>
        <Button variant="outline" size="sm" disabled={busy || selected === today} onClick={() => onSelect(today)}>Сьогодні</Button>
        <fieldset className="hide-scrollbar m-0 flex w-full min-w-0 items-center gap-2 overflow-x-auto border-0 p-0 @4xl:ml-auto @4xl:w-auto">
          <legend className="sr-only">Фільтр днів</legend>
          {DAY_FILTERS.map((item) => <Chip key={item.value} pressed={filter === item.value} onClick={() => onFilter(item.value)}>{item.label}</Chip>)}
        </fieldset>
      </div>
      <div ref={scroller} className="hide-scrollbar relative -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 py-1" aria-label="Дні місяця">
        {dates.map((date) => {
          const report = reportByDate.get(date);
          const future = date > today;
          const active = date === selected;
          const dim = !matchesFilter(filter, report) && !active;
          const labels = calendarContextLabels(date, contextByDate.get(date));
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              disabled={future || busy}
              aria-pressed={active}
              aria-label={`${formatDate(date)}. ${labels.join(', ') || 'Без подій'}. ${stateLabel(report)}`}
              title={report ? `Версій: ${report.revisionCount}` : undefined}
              onClick={() => onSelect(date)}
              className={cn(
                'flex h-[72px] w-[54px] shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-full border text-center transition-[background-color,border-color,color,opacity] duration-200 active:scale-[0.985] disabled:pointer-events-none',
                active ? 'border-transparent bg-action text-action-ink' : 'border-line hover:bg-raised',
                future && 'opacity-35',
                dim && 'opacity-35',
              )}
            >
              <span className={cn('text-xs', active ? 'opacity-70' : 'text-ink-2')}>{weekday(date)}</span>
              <span className="font-mono text-[15px]">{Number(date.slice(8))}</span>
              <i
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  !report && 'opacity-0',
                  report?.stale ? 'bg-hot' : report?.submittedAt ? 'bg-ok' : report ? 'border border-current' : '',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
