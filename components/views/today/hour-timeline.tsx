'use client';

import { FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { clockOf, dayOf, hourLabel, shortDate, type DayEvent, type Segment } from '@/components/views/today/day-model';
import { EventRow, HatchDefs, Legend, SegmentBar, TimelineItem } from '@/components/views/today/event-parts';
import type { Day } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

function NowLine({ time }: { time: string }) {
  return (
    <p className="m-0 flex min-h-[30px] items-center gap-2.5 text-xs font-medium text-hot">
      Зараз {time}<i aria-hidden="true" className="h-px flex-1 bg-hot" />
    </p>
  );
}

function hourParts(segments: readonly Segment[], hour: number) {
  const a = hour * 60;
  const b = a + 60;
  return segments.filter((segment) => segment.to > a && segment.from < b).map((segment) => {
    const from = Math.max(segment.from, a);
    const to = Math.min(segment.to, b);
    return { top: ((from - a) / 60) * 100, height: ((to - from) / 60) * 100, kind: segment.kind };
  });
}

function formatLong(day: string) {
  const text = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  return text.toLowerCase();
}

/**
 * «День за годинами» для телефона й планшета: легенда, рядок про незданий вчорашній звіт, шкала по годинах із сегментами
 * роботи й паузи ліворуч, подіями й лінією «зараз», нижче «Завтра». Одна прокрутка сторінки.
 */
export function HourTimeline({ day }: { day: Day }) {
  const { model, now } = day;
  const hours: number[] = [];
  for (let hour = model.range.from / 60; hour < model.range.to / 60; hour += 1) hours.push(hour);
  const nowHour = Math.floor(model.nowMinutes / 60);
  const minutesOf = (event: DayEvent) => (event.at - model.dayStart) / 60;
  const touch = true;
  const timeOf = (event: DayEvent) => (dayOf(event.at) === dayOf(now) ? clockOf(event.at) : shortDate(dayOf(event.at)));

  return (
    <Surface variant="glass" radius="card" data-reveal className="min-w-0 p-3.5 pl-2.5" aria-labelledby="timeline-title">
      <HatchDefs />
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-1">
        <h3 id="timeline-title" className="m-0 text-[17px] font-medium">День за годинами</h3>
        <Legend />
      </header>
      {model.earlierPauseMinutes > 0 ? <p className="m-0 mb-2 pl-1 text-xs text-ink-2">Раніше були паузи, разом {model.earlierPauseMinutes} хв. Їхній час не зберігається, на шкалі видно лише поточну паузу.</p> : null}

      {day.yesterdayPending ? (
        <div className="mb-2 flex min-h-[42px] min-w-0 items-center gap-2 rounded-inner bg-sunken py-1 pl-2.5 pr-2">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full border border-warn bg-sunken text-warn"><FileText strokeWidth={1.5} className="size-3.5" /></span>
          <span className="min-w-0 flex-1 px-1.5 py-1">
            <b className="block truncate text-sm font-medium text-hot">Звіт за вчора не здано</b>
            <small className="block truncate text-xs text-ink-2">{formatLong(day.yesterdayDate)}</small>
          </span>
          <Button variant="outline" size="sm" onClick={day.openYesterday} className="h-11 shrink-0 px-4">До звіту</Button>
        </div>
      ) : null}

      {model.carry.length ? (
        <div className="mb-1.5">
          <h4 className="m-0 px-2 pb-0.5 pt-1 text-xs font-medium text-ink-2">Прострочено за минулі дні</h4>
          {model.carry.map((event) => <EventRow key={event.id} event={event} time={timeOf(event)} action={day.actionOf(event)} touch={touch} onOpen={day.openEvent} />)}
        </div>
      ) : null}

      <ol className="m-0 list-none p-0">
        {hours.map((hour) => {
          const items = model.events.filter((event) => Math.floor(minutesOf(event) / 60) === hour);
          const here = hour === nowHour;
          const parts = hourParts(model.segments, hour);
          let placed = false;
          const nodes: ReactNode[] = [];
          for (const event of items) {
            if (here && !placed && minutesOf(event) > model.nowMinutes) { nodes.push(<NowLine key="now" time={clockOf(now)} />); placed = true; }
            nodes.push(<TimelineItem key={event.id} event={event} action={day.actionOf(event)} touch={touch} onOpen={day.openEvent} />);
          }
          if (here && !placed) nodes.push(<NowLine key="now" time={clockOf(now)} />);
          return (
            <li key={hour} className="relative grid min-h-[52px] grid-cols-[42px_minmax(0,1fr)] gap-x-2 border-t border-line pl-2.5">
              <span className="absolute inset-y-0 left-0 w-1"><SegmentBar parts={parts} className="h-full w-full" /></span>
              <span className={cn('pt-[15px] font-mono text-xs tabular-nums', here ? 'text-ink' : 'text-ink-2')}>{hourLabel(hour * 60)}</span>
              <div className="flex min-w-0 flex-col gap-1.5 py-2">{nodes}</div>
            </li>
          );
        })}
      </ol>

      {model.tomorrow.length ? (
        <div className="mt-1.5">
          <h4 className="m-0 px-2 pb-0.5 pt-3.5 text-xs font-medium text-ink-2">Завтра</h4>
          {model.tomorrow.map((event) => <EventRow key={event.id} event={event} time="завтра" action={day.actionOf(event)} touch={touch} onOpen={day.openEvent} />)}
        </div>
      ) : null}
    </Surface>
  );
}
