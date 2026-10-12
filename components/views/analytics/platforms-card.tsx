'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { SectionCard } from '@/components/views/shared/card';
import { cn } from '@/lib/utils';
import { METRIC_ITEMS, pairPlatforms, percentLabel, rankByCount, rankConversion, summarizePlatforms, type ConversionRow, type CountMetric, type CountRow, type Delta, type PlatformMetric } from './platform-compare';
import type { AnalyticsPeriod, PlatformRow } from './types';

const OPEN_HINT = 'Показати чати цієї платформи в рейтингу нижче';

/** Платформи: хто дає відгуки, записи й проведені, у кого найкраща конверсія і хто просідає проти порівняльного періоду. */
export function PlatformsCard({ platforms, previous, period, chatPlatforms, onSelectPlatform, className }: {
  platforms: PlatformRow[];
  previous: PlatformRow[] | null;
  period: AnalyticsPeriod;
  /** Платформи, чати яких є в рейтингу нижче: лише їх рядки відкривають фільтр. */
  chatPlatforms: ReadonlySet<string>;
  onSelectPlatform: (key: string) => void;
  className?: string;
}) {
  const [metric, setMetric] = useState<PlatformMetric>('responses');
  const pairs = useMemo(() => pairPlatforms(platforms, previous), [platforms, previous]);
  const summary = useMemo(() => summarizePlatforms(pairs, period), [pairs, period]);
  const counts = useMemo(() => (metric === 'conversion' ? [] : rankByCount(pairs, metric)), [pairs, metric]);
  const conversions = useMemo(() => (metric === 'conversion' ? rankConversion(pairs) : []), [pairs, metric]);

  return (
    <SectionCard
      className={className}
      title="Платформи"
      aside={pairs.length ? <Segmented<PlatformMetric> label="Показник платформ" size="sm" value={metric} onValueChange={setMetric} items={METRIC_ITEMS} /> : undefined}
    >
      {pairs.length === 0 ? (
        <EmptyState text="За цей період на платформах ще немає подій." />
      ) : (
        <>
          <p className="m-0 max-w-[72ch] text-sm">{summary}</p>
          <ul aria-label="Платформи за показником" className="m-0 flex list-none flex-col p-0">
            {metric === 'conversion'
              ? conversions.map((row) => (
                <Row key={row.key} platform={row.key} enabled={chatPlatforms.has(row.key)} onOpen={onSelectPlatform}><ConversionLine row={row} /></Row>
              ))
              : counts.map((row) => (
                <Row key={row.key} platform={row.key} enabled={chatPlatforms.has(row.key)} onOpen={onSelectPlatform}><CountLine row={row} metric={metric} /></Row>
              ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function Row({ platform, enabled, onOpen, children }: { platform: string; enabled: boolean; onOpen: (key: string) => void; children: ReactNode }) {
  return (
    <li className="border-t border-line first:border-t-0">
      {enabled ? (
        <button type="button" title={OPEN_HINT} onClick={() => onOpen(platform)} className="-mx-2 block w-[calc(100%+1rem)] rounded-inner px-2 py-3 text-left transition-colors duration-200 hover:bg-raised">{children}</button>
      ) : (
        <div className="py-3">{children}</div>
      )}
    </li>
  );
}

function CountLine({ row, metric }: { row: CountRow; metric: CountMetric }) {
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2">
      <span className="min-w-0 truncate text-sm">{row.name}</span>
      <span className="flex items-baseline justify-end gap-3 font-mono">
        <span className="text-[15px]" title={row.previous ? `Було ${row.previous[metric]}` : undefined}>{row.value}</span>
        <span className="text-xs text-ink-2">{row.sharePercent}%</span>
        <DeltaLabel delta={row.delta} />
      </span>
      <span aria-hidden="true" className="col-span-2 block h-1 overflow-hidden rounded-full bg-line">
        <span className="block h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${row.share})`, transition: 'transform 0.32s var(--ease-out)' }} />
      </span>
    </span>
  );
}

function DeltaLabel({ delta }: { delta: Delta }) {
  if (delta.kind === 'none') return null;
  if (delta.kind === 'new') return <span className="text-xs text-ink-2">нове</span>;
  const percent = Math.round(Math.abs(delta.ratio) * 100);
  if (percent === 0) return <span className="text-xs text-ink-2">без змін</span>;
  const up = delta.ratio > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs', delta.significant ? (up ? 'text-ok' : 'text-hot') : 'text-ink-2')}>
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-3" />
      <span className="sr-only">{up ? 'Зросло на ' : 'Впало на '}</span>{percent}%
    </span>
  );
}

function ConversionLine({ row }: { row: ConversionRow }) {
  const { current } = row;
  const step = (value: number, base: number) => (base > 0 ? percentLabel(value / base) : '—');
  // Телефон: шапка з назвою й міткою, під нею чотири кроки. Широкий екран: усе в одному рядку, мітка праворуч.
  return (
    <span className="grid grid-cols-4 items-end gap-x-2 gap-y-2 @4xl:grid-cols-[minmax(140px,1fr)_repeat(4,minmax(0,0.8fr))_minmax(140px,auto)] @4xl:items-center @4xl:gap-x-6">
      <span className="col-span-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 @4xl:contents">
        <span className="min-w-0 truncate text-sm @4xl:order-first">{row.name}</span>
        <span className="@4xl:order-last @4xl:text-right"><MarkLabel row={row} /></span>
      </span>
      <Step label="Огол." value={current.publications} />
      <Step label="Відгуки" value={current.responses} percent={step(current.responses, current.publications)} />
      <Step label="Записи" value={current.bookings} percent={step(current.bookings, current.responses)} />
      <Step label="Проведені" value={current.completed} percent={step(current.completed, current.bookings)} />
    </span>
  );
}

function MarkLabel({ row }: { row: ConversionRow }) {
  if (row.mark === 'best') return <span className="text-xs text-ok">Найкраща</span>;
  if (row.mark === 'drop') return <span className="text-xs text-hot">Просідає{row.previousRate !== null ? ` · було ${percentLabel(row.previousRate)}` : ''}</span>;
  if (row.mark === 'small') return <span className="text-xs text-ink-3">Мала вибірка</span>;
  return null;
}

function Step({ label, value, percent }: { label: string; value: number; percent?: string }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[11px] text-ink-2">{label}</span>
      <span className="block font-mono text-[15px]">{value}</span>
      <span className="block font-mono text-xs text-ink-2">{percent ?? '\u00a0'}</span>
    </span>
  );
}
