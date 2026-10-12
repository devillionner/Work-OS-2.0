'use client';

import { BellRing, Check, ClipboardCheck, Flag, Pause, Play, Send, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { DayEvent, EventKind, EventState, Segment } from '@/components/views/today/day-model';
import type { EventAction } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

const ICON: Record<EventKind, LucideIcon> = { slot: Send, reminder: BellRing, checkpoint: ClipboardCheck, start: Play, pause: Pause, end: Flag };

/**
 * Стан маркера без жовтого: попереду — тонке обведення; час настав — інвертований кружок; виконано — галочка на --raised;
 * пропущено — пунктир; прострочено — єдиний колір шкали (--signal-hot).
 */
const TONE = {
  pending: 'border-line text-ink-2',
  due: 'border-action bg-action text-action-ink',
  done: 'border-transparent bg-raised text-ink-2',
  missed: 'border-dashed border-line-strong text-ink-3',
  alert: 'border-hot text-hot',
} as const;
type MarkerTone = keyof typeof TONE;

const toneOf = (kind: EventKind, state: EventState): MarkerTone => {
  if (kind === 'start' || kind === 'pause' || kind === 'end') return 'pending';
  return state === 'overdue' || state === 'late' ? 'alert' : state === 'due' ? 'due' : state === 'missed' ? 'missed' : state === 'done' ? 'done' : 'pending';
};

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

/** Пояснення шкали: слот, нагадування, звіт, прострочено, робота, пауза. */
export function Legend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-ink-2', className)}>
      <span className="inline-flex items-center gap-1.5"><Send aria-hidden="true" strokeWidth={1.5} className="size-3.5" />слот</span>
      <span className="inline-flex items-center gap-1.5"><BellRing aria-hidden="true" strokeWidth={1.5} className="size-3.5" />нагадування</span>
      <span className="inline-flex items-center gap-1.5"><ClipboardCheck aria-hidden="true" strokeWidth={1.5} className="size-3.5" />звіт</span>
      <span className="inline-flex items-center gap-1.5 text-hot"><i aria-hidden="true" className="size-2 rounded-full bg-hot" />прострочено</span>
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="size-2.5 rounded-[3px] bg-ink" />робота</span>
      <span className="inline-flex items-center gap-1.5"><svg aria-hidden="true" width="10" height="10" className="rounded-[3px] border border-line-strong"><rect width="10" height="10" style={{ fill: 'url(#today-hatch)' }} /></svg>пауза</span>
    </div>
  );
}

/** Єдиний маркер події: кружок 28 px з іконкою lucide 16 px. Виконані слоти й звіти показують галочку; початок, пауза й кінець дня — власну іконку з тонким обведенням. */
export function Marker({ kind, state, className }: { kind: EventKind; state: EventState; className?: string }) {
  const Icon = state === 'done' && (kind === 'slot' || kind === 'checkpoint' || kind === 'reminder') ? Check : ICON[kind];
  return (
    <span aria-hidden="true" className={cn('grid size-7 shrink-0 place-items-center rounded-full border', TONE[toneOf(kind, state)], className)}>
      <Icon strokeWidth={1.5} className="size-4" />
    </span>
  );
}

export function EventLead({ event, className }: { event: DayEvent; className?: string }) {
  return <Marker kind={event.kind} state={event.state} className={className} />;
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
      <EventLead event={event} />
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
