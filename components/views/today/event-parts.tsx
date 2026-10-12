'use client';

import { Check, FileText, Pause, Play, Send, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { DayEvent, EventKind, Segment } from '@/components/views/today/day-model';
import type { EventAction } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

const ICON: Record<Exclude<EventKind, 'reminder'>, typeof Send> = { slot: Send, checkpoint: FileText, start: Play, pause: Pause, end: Square };

/** Штрихування паузи: один `<pattern>` на екран, рамки інших елементів посилаються на нього через `url(#today-hatch)`. */
export function HatchDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="pointer-events-none absolute">
      <defs>
        <pattern id="today-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" strokeWidth="2" style={{ stroke: 'var(--ink-3)' }} />
        </pattern>
      </defs>
    </svg>
  );
}

/** Вертикальна смуга відпрацьованого часу: заливка — робота, штрихування — пауза. Відрізок задано у відсотках висоти. */
export function SegmentBar({ parts, className }: { parts: ReadonlyArray<{ top: number; height: number; kind: Segment['kind'] }>; className?: string }) {
  if (!parts.length) return null;
  return (
    <svg aria-hidden="true" width="100%" height="100%" className={cn('block overflow-hidden rounded-sm', className)}>
      {parts.map((part, index) => <rect key={index} x="0" width="100%" y={`${part.top}%`} height={`${part.height}%`} style={{ fill: part.kind === 'work' ? 'var(--ink)' : 'url(#today-hatch)' }} />)}
    </svg>
  );
}

/** Пояснення шкали: робота, пауза, прострочено, слот, звіт. */
export function Legend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-ink-2', className)}>
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-[3px] bg-ink" />робота</span>
      <span className="inline-flex items-center gap-1.5"><svg aria-hidden="true" width="10" height="10" className="rounded-[3px] border border-line-strong"><rect width="10" height="10" style={{ fill: 'url(#today-hatch)' }} /></svg>пауза</span>
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2 rounded-full bg-hot" />прострочено</span>
      <span className="inline-flex items-center gap-1.5"><Send aria-hidden="true" strokeWidth={1.5} className="size-3.5" />слот</span>
      <span className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" strokeWidth={1.5} className="size-3.5" />звіт</span>
    </div>
  );
}

/** Маркер події: крапка для нагадувань, кружок з іконкою для решти. */
export function EventLead({ event, className }: { event: DayEvent; className?: string }) {
  if (event.kind === 'reminder') {
    const late = event.state === 'overdue';
    return <i role={late ? 'img' : undefined} aria-label={late ? 'Прострочено' : undefined} aria-hidden={late ? undefined : true} className={cn('size-2 shrink-0 rounded-full', late ? 'bg-hot' : 'bg-ink-3', className)} />;
  }
  const Icon = ICON[event.kind];
  const warn = event.state === 'due' || event.state === 'late' || event.state === 'missed';
  return (
    <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-full border bg-sunken', warn ? 'border-warn text-warn' : 'border-line text-ink-2', className)}>
      <Icon strokeWidth={1.5} className="size-3.5" />
    </span>
  );
}

/** Дія події: «Готово», «Здати», «Уточнити» або кругла галочка для слота. */
export function EventActionButton({ action, touch }: { action: EventAction; touch: boolean }) {
  if (action.round) {
    return (
      <Button variant="outline" size="sm" busy={action.busy} title={action.label} aria-label={action.label} onClick={action.run} className={cn('size-8 shrink-0 px-0', touch && 'size-11')}>
        <Check aria-hidden="true" strokeWidth={1.5} />
      </Button>
    );
  }
  return <Button variant="outline" size="sm" busy={action.busy} onClick={action.run} className={cn('shrink-0', touch && 'h-11 px-4')}>{action.label}</Button>;
}

function EventText({ event, onOpen, trailing }: { event: DayEvent; onOpen: (() => void) | null; trailing?: ReactNode }) {
  const body = (
    <>
      <b className={cn('block truncate text-sm', event.dim ? 'font-normal text-ink-2' : 'font-medium')}>{event.title}</b>
      <small className="block truncate text-xs text-ink-2">{event.sub}</small>
    </>
  );
  return (
    <>
      {onOpen ? (
        <button type="button" onClick={onOpen} title={event.title} className="min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left transition-colors duration-150 hover:bg-raised">{body}</button>
      ) : (
        <span className="min-w-0 flex-1 px-1.5 py-1">{body}</span>
      )}
      {trailing}
    </>
  );
}

const OPENABLE: ReadonlySet<EventKind> = new Set(['slot', 'reminder', 'checkpoint']);

/** Рядок події на всю ширину: час, маркер, текст, дія. Для шкали «Зараз у центрі», прострочених за минулі дні й «Завтра». */
export function EventRow({ event, time, action, touch, onOpen, bordered = true, className }: { event: DayEvent; time: string; action: EventAction | null; touch: boolean; onOpen: (event: DayEvent) => void; bordered?: boolean; className?: string }) {
  return (
    <div data-event={event.id} className={cn('flex min-h-14 items-center gap-2 py-1.5 pl-2 pr-0.5 @4xl:gap-2.5', bordered && 'border-t border-line first:border-t-0', className)}>
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-ink-2 @4xl:w-[46px]">{time}</span>
      <EventLead event={event} className={event.kind === 'reminder' ? 'mx-2' : undefined} />
      <EventText event={event} onOpen={OPENABLE.has(event.kind) ? () => onOpen(event) : null} trailing={action ? <EventActionButton action={action} touch={touch} /> : null} />
    </div>
  );
}

/** Подія у шкалі по годинах: без колонки часу (годину показує рядок шкали), у формі плитки. */
export function TimelineItem({ event, action, touch, onOpen }: { event: DayEvent; action: EventAction | null; touch: boolean; onOpen: (event: DayEvent) => void }) {
  const tone = event.kind === 'checkpoint' ? 'border border-dashed border-line-strong' : event.kind === 'start' || event.kind === 'end' ? 'bg-raised' : event.kind === 'pause' ? 'border border-line' : event.next ? 'border border-line-strong bg-raised' : 'bg-sunken';
  return (
    <div data-event={event.id} className={cn('flex min-h-[42px] min-w-0 items-center gap-2 rounded-inner py-1 pl-2.5 pr-2', tone)}>
      <EventLead event={event} />
      <EventText event={event} onOpen={OPENABLE.has(event.kind) ? () => onOpen(event) : null} trailing={action ? <EventActionButton action={action} touch={touch} /> : null} />
    </div>
  );
}
