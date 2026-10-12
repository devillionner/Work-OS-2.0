'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { clockOf, dayOf, describeUpcoming, hourLabel, layoutY, shortDate, span, type DayEvent } from '@/components/views/today/day-model';
import { EventRow, SegmentBar } from '@/components/views/today/event-parts';
import { buildTimeAxis } from '@/components/views/today/time-axis';
import type { Day } from '@/components/views/today/use-day';
import { cn } from '@/lib/utils';

/** Пікселів на хвилину, частка висоти вікна, де стоїть закріплена лінія «зараз», і висоти карток. */
const PPM = 1.6;
const LINE = 0.5;
const MAIN_H = 56;
const MINOR_H = 38;
const CARRY_HEAD = 28;
const CARRY_ROW = 56;
/** Відступ від верху вмісту, вище якого не піднімаються ні картки, ні мітки годин. */
const EDGE = 8;

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;

/**
 * «Зараз у центрі» для ПК: великий заголовок-відлік до наступної події й вікно шкали дня, де лінія «зараз» закріплена
 * посередині. Прокрутка рухає день під лінією; лінія видна лише в жолобі осі годин і хвостиком після карток, тож картки не
 * розрізає. Мітка в жолобі показує, куди відгорнули, «До зараз» зі стрілкою в бік поточного часу повертає. Рядки стоять за
 * часом без накладань (`layoutY`), а час на осі рахується через їхні справжні позиції (`time-axis`): мітки годин, смуга
 * роботи, позначка «зараз» і мітка лінії не брешуть там, де події стоять щільно. Позиція лінії оновлюється щохвилини без мережі.
 */
export function CenteredTimeline({ day }: { day: Day }) {
  const { model, now, workday } = day;
  const viewport = useRef<HTMLDivElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const deltaLabel = useRef<HTMLSpanElement>(null);
  const upButton = useRef<HTMLDivElement>(null);
  const downButton = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const under = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  const minutesOf = (event: DayEvent) => (event.at - model.dayStart) / 60;
  const y = (minutes: number) => (minutes - model.range.from) * PPM;
  const yNow = y(model.nowMinutes);
  const heightOf = (event: DayEvent) => (event.kind === 'slot' || event.kind === 'reminder' || event.kind === 'checkpoint' ? MAIN_H : MINOR_H);
  const positions = layoutY(model.events.map((event) => ({ key: event.id, minutes: minutesOf(event), height: heightOf(event), offset: 8 })), y, yNow, model.nowMinutes, 6);
  const rawTop = (event: DayEvent) => positions.get(event.id) ?? y(minutesOf(event));

  // Чесна вісь часу: через центри карток, де вони справді стоять. Якщо щільне минуле виштовхнуло щось вище початку,
  // увесь вміст зсувається вниз на однакову величину (відносні позиції не змінюються).
  const axis = buildTimeAxis(model.events.map((event) => ({ minutes: minutesOf(event), px: rawTop(event) + heightOf(event) / 2 })), PPM, { minutes: model.range.from, px: 0 });
  const shift = Math.max(0, EDGE - Math.min(axis.toPx(model.range.from) - 7, ...model.events.map(rawTop)));
  const px = (minutes: number) => axis.toPx(minutes) + shift;
  const minutesAt = (value: number) => axis.toMinutes(value - shift);
  const topOf = (event: DayEvent) => rawTop(event) + shift;
  const pNow = px(model.nowMinutes);

  let boxHeight = Math.max((model.range.to - model.range.from) * PPM, px(model.range.to) + EDGE);
  for (const event of model.events) boxHeight = Math.max(boxHeight, topOf(event) + heightOf(event) + EDGE);
  const carryHeight = model.carry.length ? CARRY_HEAD + model.carry.length * CARRY_ROW + 12 : 0;
  const nowTarget = carryHeight + pNow;
  const hours: number[] = [];
  for (let hour = model.range.from / 60; hour <= model.range.to / 60; hour += 1) hours.push(hour);

  /** Мітка лінії, кнопка «До зараз» і підсвітка картки під лінією: пряма робота з DOM, щоб прокрутка не перемальовувала React. */
  const sync = () => {
    const node = viewport.current;
    if (!node) return;
    const scroll = node.scrollTop;
    const near = Math.abs(scroll - nowTarget) < 8;
    pinned.current = near;
    const boxY = scroll - carryHeight;

    let time: string;
    let delta = '';
    if (near) {
      time = clockOf(now);
      delta = 'зараз';
    } else if (boxY < -EDGE) {
      time = 'Минулі дні';
    } else if (boxY > boxHeight) {
      time = 'Завтра';
    } else {
      const minutes = Math.min(1439, Math.max(0, Math.round(minutesAt(boxY))));
      const diff = minutes - Math.round(model.nowMinutes);
      time = hourLabel(minutes);
      delta = diff === 0 ? 'зараз' : `${diff > 0 ? '+' : '−'}${span(Math.abs(diff))}`;
    }
    if (timeLabel.current) timeLabel.current.textContent = time;
    if (deltaLabel.current) {
      deltaLabel.current.textContent = delta;
      deltaLabel.current.hidden = !delta;
    }
    if (upButton.current) upButton.current.hidden = near || scroll <= nowTarget;
    if (downButton.current) downButton.current.hidden = near || scroll >= nowTarget;

    const hit = model.events.find((event) => boxY >= topOf(event) && boxY <= topOf(event) + heightOf(event));
    const card = hit ? cards.current.get(hit.id) ?? null : null;
    if (card !== under.current) {
      under.current?.removeAttribute('data-under');
      card?.setAttribute('data-under', '');
      under.current = card;
    }
  };

  // Лінія «зараз» стоїть на місці: коли минає хвилина (чи змінюється вміст), день зсувається під нею.
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (pinned.current) node.scrollTop = nowTarget;
    sync();
  });

  const scrollTo = (top: number) => viewport.current?.scrollTo({ top: Math.max(0, top), behavior: smooth() });
  const toFirstAttention = () => {
    const first = model.attention[0];
    if (!first) return;
    const carryIndex = model.carry.indexOf(first);
    scrollTo(carryIndex >= 0 ? CARRY_HEAD + carryIndex * CARRY_ROW + CARRY_ROW / 2 : carryHeight + topOf(first) + heightOf(first) / 2);
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
          <section ref={viewport} aria-label="Шкала дня, прокручується" onScroll={sync} className="hide-scrollbar fade-y absolute inset-0 overflow-y-auto overscroll-contain" style={{ containerType: 'size' }}>
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
                    {Math.abs(px(hour * 60) - pNow) >= 14 ? <span className="absolute left-0 font-mono text-[10.5px] leading-[14px] tabular-nums text-ink-2" style={{ top: px(hour * 60) - 7 }}>{hourLabel(hour * 60)}</span> : null}
                    <i aria-hidden="true" className="absolute left-[110px] h-px w-2.5 bg-line-strong" style={{ top: px(hour * 60) }} />
                  </Fragment>
                ))}
                {model.segments.map((segment, index) => (
                  <span key={index} aria-hidden="true" className="absolute left-[104px] w-1" style={{ top: px(segment.from), height: Math.max(2, px(segment.to) - px(segment.from)) }}>
                    <SegmentBar parts={[{ top: 0, height: 100, kind: segment.kind }]} className="h-full w-full" />
                  </span>
                ))}
                <i aria-hidden="true" className="absolute left-[102px] size-2 -translate-y-1/2 rounded-full bg-hot" style={{ top: pNow }} />
                {model.events.map((event) => (
                  <div
                    key={event.id}
                    ref={(node) => { if (node) cards.current.set(event.id, node); else cards.current.delete(event.id); }}
                    className={cn('absolute left-[128px] right-0 overflow-hidden rounded-[16px] border data-[under]:bg-raised', event.state === 'overdue' ? 'border-hot' : 'border-line', !event.dim && 'bg-sunken')}
                    style={{ top: topOf(event), height: heightOf(event) }}
                  >
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

          <div className="pointer-events-none absolute inset-0 z-[5]">
            <div aria-hidden="true" className="absolute inset-x-0 h-0" style={{ top: `${LINE * 100}%` }}>
              <span className="absolute left-5 top-0 h-px w-[122px] bg-ink-2" />
              <span className="absolute right-1 top-0 h-px w-3.5 bg-ink-2" />
              <div className="absolute left-5 top-0 flex min-w-16 -translate-y-1/2 flex-col items-center rounded-full bg-action px-2.5 py-1 text-action-ink">
                <span ref={timeLabel} className="font-mono text-xs leading-4 tabular-nums" />
                <span ref={deltaLabel} className="text-[10.5px] leading-3 tabular-nums opacity-70" />
              </div>
            </div>
            <div ref={upButton} hidden className="pointer-events-auto absolute right-5 top-3">
              <Button variant="outline" size="sm" onClick={() => scrollTo(nowTarget)} className="bg-glass-strong"><ArrowUp aria-hidden="true" strokeWidth={1.5} />До зараз</Button>
            </div>
            <div ref={downButton} hidden className="pointer-events-auto absolute bottom-3 right-5">
              <Button variant="outline" size="sm" onClick={() => scrollTo(nowTarget)} className="bg-glass-strong"><ArrowDown aria-hidden="true" strokeWidth={1.5} />До зараз</Button>
            </div>
          </div>
        </div>
      </Surface>
    </div>
  );
}
