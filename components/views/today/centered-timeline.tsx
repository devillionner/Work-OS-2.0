'use client';

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { clockOf, dayOf, describeUpcoming, hourLabel, layoutY, shortDate, span, type DayEvent } from '@/components/views/today/day-model';
import { EventRow, SegmentBar } from '@/components/views/today/event-parts';
import type { Day } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

/** Пікселів на хвилину, частка висоти вікна, де стоїть закріплена лінія «зараз», і висоти карток. */
const PPM = 1.6;
const LINE = 0.5;
const MAIN_H = 56;
const MINOR_H = 38;
const CARRY_HEAD = 28;
const CARRY_ROW = 56;

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;

/**
 * «Зараз у центрі» для ПК: великий заголовок-відлік до наступної події й вікно шкали дня, де лінія «зараз» закріплена
 * посередині. Прокрутка рухає день під лінією, мітка на лінії показує, куди відгорнули, «До зараз» повертає. Минуле зверху
 * блідне, майбутнє внизу; події не накладаються (розкладка за часом). Позиція лінії оновлюється щохвилини без мережі.
 */
export function CenteredTimeline({ day }: { day: Day }) {
  const { model, now, workday } = day;
  const viewport = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);

  const minutesOf = (event: DayEvent) => (event.at - model.dayStart) / 60;
  const y = (minutes: number) => (minutes - model.range.from) * PPM;
  const yNow = y(model.nowMinutes);
  const heightOf = (event: DayEvent) => (event.kind === 'slot' || event.kind === 'reminder' || event.kind === 'checkpoint' ? MAIN_H : MINOR_H);
  const positions = layoutY(model.events.map((event) => ({ key: event.id, minutes: minutesOf(event), height: heightOf(event), offset: 8 })), y, yNow, model.nowMinutes, 6);
  let boxHeight = (model.range.to - model.range.from) * PPM;
  for (const event of model.events) boxHeight = Math.max(boxHeight, (positions.get(event.id) ?? 0) + heightOf(event) + 8);
  const carryHeight = model.carry.length ? CARRY_HEAD + model.carry.length * CARRY_ROW + 12 : 0;
  const nowTarget = carryHeight + yNow;
  const hours: number[] = [];
  for (let hour = model.range.from / 60; hour <= model.range.to / 60; hour += 1) hours.push(hour);

  const describeAt = (top: number) => {
    if (top < carryHeight - 8) return 'Минулі дні';
    const minutes = model.range.from + (top - carryHeight) / PPM;
    if (minutes > model.range.to) return 'Завтра';
    const diff = Math.round(minutes - model.nowMinutes);
    return `${hourLabel(Math.round(minutes))} · ${diff >= 0 ? 'через' : 'було'} ${span(Math.abs(diff))}`;
  };

  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    const near = Math.abs(node.scrollTop - nowTarget) < 8;
    pinned.current = near;
    if (label.current) label.current.textContent = near ? `${clockOf(now)} · зараз` : describeAt(node.scrollTop);
    setAway(!near);
  };

  // Лінія «зараз» стоїть на місці: коли минає хвилина (чи змінюється вміст), день зсувається під нею.
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (pinned.current) node.scrollTop = nowTarget;
    if (label.current) label.current.textContent = pinned.current ? `${clockOf(now)} · зараз` : describeAt(node.scrollTop);
  });

  const scrollTo = (top: number) => viewport.current?.scrollTo({ top: Math.max(0, top), behavior: smooth() });
  const toFirstAttention = () => {
    const first = model.attention[0];
    if (!first) return;
    const carryIndex = model.carry.indexOf(first);
    scrollTo(carryIndex >= 0 ? CARRY_HEAD + carryIndex * CARRY_ROW + CARRY_ROW / 2 : carryHeight + (positions.get(first.id) ?? y(minutesOf(first))) + heightOf(first) / 2);
  };

  const started = workday.workday !== null && workday.workday.workDate === dayOf(now);
  const headline = describeUpcoming(model, now, started);
  const primary = headline.event ? day.actionOf(headline.event) : null;
  const timeOf = (event: DayEvent) => (dayOf(event.at) === dayOf(now) ? clockOf(event.at) : shortDate(dayOf(event.at)));

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <Surface variant="glass" radius="card" data-reveal className="@container flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-3.5 px-7 py-[22px]" aria-labelledby="countdown-title">
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-1.5">
          {model.attention.length ? (
            <button type="button" onClick={toFirstAttention} title="Перейти до першої справи, що потребує уваги" className="inline-flex h-7 items-center gap-2 self-start whitespace-nowrap rounded-full border border-line-strong px-3 text-[12.5px] transition-colors duration-150 hover:bg-raised">
              <i aria-hidden="true" className="size-2 rounded-full bg-hot" />Потребує уваги · {model.attention.length}
            </button>
          ) : null}
          <h2 id="countdown-title" className="m-0 text-balance text-[clamp(22px,5.4cqi,34px)] font-normal leading-[1.1] tracking-[-0.03em]">
            {headline.event ? <>{headline.when} <span className="text-ink-2">— {headline.what}</span></> : <><span className="text-ink-2">{headline.when}</span> {headline.what}</>}
          </h2>
          <p className="m-0 text-[13.5px] text-ink-2">{headline.hint}</p>
        </div>
        {headline.event ? (
          <div className="flex shrink-0 gap-2.5">
            {primary ? <Button variant="action" size="lg" busy={primary.busy} onClick={primary.run}>{primary.label}</Button> : null}
            <Button variant="outline" size="lg" onClick={() => day.openEvent(headline.event as DayEvent)}>Відкрити</Button>
          </div>
        ) : null}
      </Surface>

      <Surface variant="glass" radius="card" data-reveal className="relative flex min-h-0 flex-1 overflow-hidden p-0" aria-label="Шкала дня">
        <div className="relative min-w-0 flex-1">
          <section ref={viewport} aria-label="Шкала дня, прокручується" onScroll={onScroll} className="hide-scrollbar fade-y absolute inset-0 overflow-y-auto overscroll-contain" style={{ containerType: 'size' }}>
            {/* Відступи зверху й знизу у відсотках висоти вікна (cqh), щоб будь-яку хвилину можна було поставити під лінію без вимірювань. */}
            <div style={{ paddingTop: `${LINE * 100}cqh`, paddingBottom: `${(1 - LINE) * 100}cqh` }}>
              {model.carry.length ? (
                <div className="mx-5 mb-3">
                  <h3 className="m-0 flex h-7 items-center px-2 text-xs font-medium text-ink-2">Прострочено за минулі дні</h3>
                  {model.carry.map((event) => <EventRow key={event.id} event={event} time={timeOf(event)} action={day.actionOf(event)} touch={false} onOpen={day.openEvent} bordered={false} className="h-14 min-h-0" />)}
                </div>
              ) : null}

              <div className="relative mx-5" style={{ height: boxHeight }}>
                {hours.map((hour) => (
                  <Fragment key={hour}>
                    {Math.abs(y(hour * 60) - yNow) >= 14 ? <span className="absolute left-0 font-mono text-[10.5px] leading-[14px] tabular-nums text-ink-2" style={{ top: y(hour * 60) - 7 }}>{hourLabel(hour * 60)}</span> : null}
                    <i aria-hidden="true" className="absolute left-14 h-px w-2.5 bg-line-strong" style={{ top: y(hour * 60) }} />
                  </Fragment>
                ))}
                {model.segments.map((segment, index) => (
                  <span key={index} aria-hidden="true" className="absolute left-[50px] w-1" style={{ top: y(segment.from), height: Math.max(2, (segment.to - segment.from) * PPM) }}>
                    <SegmentBar parts={[{ top: 0, height: 100, kind: segment.kind }]} className="h-full w-full" />
                  </span>
                ))}
                <div aria-hidden="true" className="absolute inset-x-0 h-px bg-hot/60" style={{ top: yNow }}>
                  <span className="absolute -top-2 left-0 rounded-full bg-glass-strong px-1.5 text-[11px] font-medium leading-4 text-hot">зараз</span>
                </div>
                {model.events.map((event) => (
                  <div key={event.id} className={cn('absolute left-[70px] right-0 overflow-hidden rounded-[16px] border', event.state === 'overdue' ? 'border-hot' : 'border-line', !event.dim && 'bg-sunken')} style={{ top: positions.get(event.id) ?? y(minutesOf(event)), height: heightOf(event) }}>
                    <EventRow event={event} time={clockOf(event.at)} action={day.actionOf(event)} touch={false} onOpen={day.openEvent} bordered={false} className="h-full min-h-0 py-1 pr-2" />
                  </div>
                ))}
              </div>

              {model.tomorrow.length ? (
                <div className="mx-5 pb-3 pt-4">
                  <h3 className="m-0 flex h-7 items-center px-2 text-xs font-medium text-ink-2">Завтра</h3>
                  {model.tomorrow.map((event) => <EventRow key={event.id} event={event} time="завтра" action={day.actionOf(event)} touch={false} onOpen={day.openEvent} bordered={false} className="h-14 min-h-0" />)}
                </div>
              ) : null}
            </div>
          </section>

          <div className="pointer-events-none absolute inset-x-0 z-[5] h-0" style={{ top: `${LINE * 100}%` }}>
            <span aria-hidden="true" className="absolute inset-x-5 top-0 h-px bg-ink-2" />
            <span ref={label} aria-live="off" className="absolute -top-3 left-5 rounded-full bg-action px-2.5 font-mono text-xs leading-6 tabular-nums text-action-ink" />
            {away ? <Button variant="outline" size="sm" onClick={() => scrollTo(nowTarget)} className="pointer-events-auto absolute -top-[18px] right-5 bg-glass-strong">До зараз</Button> : null}
          </div>
        </div>
      </Surface>
    </div>
  );
}
