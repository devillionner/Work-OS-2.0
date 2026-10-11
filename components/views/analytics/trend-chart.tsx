'use client';

import { useId, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMediaQuery } from '@/components/shell/use-media';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { SectionCard } from '@/components/views/shared/card';
import { formatShort, SERIES, type SeriesKey, type TrendPoint } from './types';

const MAX_POINTS = 120;
const AXIS_TICK = { fill: 'var(--ink-2)', fontSize: 12 } as const;

type Row = { label: string; start: string; end: string; previousStart: string | null; previousEnd: string | null; current: number; previous: number | null };

/** Дні довгого періоду складаються в кошики (суми), щоб графік не губив події, а лишався ≤ 120 точок. */
function buildRows(points: readonly TrendPoint[], previous: readonly TrendPoint[] | null, series: SeriesKey): Row[] {
  const size = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const rows: Row[] = [];
  for (let start = 0; start < points.length; start += size) {
    const chunk = points.slice(start, start + size);
    const before = previous?.slice(start, start + size) ?? [];
    rows.push({
      label: formatShort(chunk[0].date),
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      previousStart: before[0]?.date ?? null,
      previousEnd: before[before.length - 1]?.date ?? null,
      current: chunk.reduce((sum, point) => sum + point[series], 0),
      previous: previous ? before.reduce((sum, point) => sum + point[series], 0) : null,
    });
  }
  return rows;
}

function span(start: string, end: string): string {
  return start === end ? formatShort(start) : `${formatShort(start)} – ${formatShort(end)}`;
}

function ChartTooltip({ active, row }: { active?: boolean; row?: Row }) {
  if (!active || !row) return null;
  return (
    <div className="glass-strong shadow-float rounded-inner px-3.5 py-2.5 text-xs">
      <p className="m-0 mb-1.5 text-ink-2">{span(row.start, row.end)}</p>
      <p className="m-0 flex items-center justify-between gap-6"><span>Поточний</span><span className="font-mono text-[13px]">{row.current}</span></p>
      {row.previous !== null && row.previousStart && row.previousEnd ? (
        <p className="m-0 mt-1 flex items-center justify-between gap-6 text-ink-2"><span>{span(row.previousStart, row.previousEnd)}</span><span className="font-mono text-[13px]">{row.previous}</span></p>
      ) : null}
    </div>
  );
}

function Legend({ hasPrevious }: { hasPrevious: boolean }) {
  return (
    <ul className="m-0 flex list-none items-center gap-4 p-0 text-xs text-ink-2">
      <li className="flex items-center gap-2"><svg width="20" height="4" aria-hidden="true"><line x1="0" y1="2" x2="20" y2="2" stroke="var(--ink)" strokeWidth="1.5" /></svg>Поточний період</li>
      {hasPrevious ? <li className="flex items-center gap-2"><svg width="20" height="4" aria-hidden="true"><line x1="0" y1="2" x2="20" y2="2" stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="4 4" /></svg>Попередній</li> : null}
    </ul>
  );
}

/** Головний графік: поточний період — суцільна лінія зі штрихуванням під нею, попередній — пунктир. */
export default function TrendChart({ points, previous, previousWhole, periodLabel, className }: { points: readonly TrendPoint[]; previous: readonly TrendPoint[] | null; previousWhole: { label: string; trends: readonly TrendPoint[] } | null; periodLabel: string; className?: string }) {
  const [series, setSeries] = useState<SeriesKey>('publications');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const rows = useMemo(() => buildRows(points, previous, series), [points, previous, series]);
  const total = rows.reduce((sum, row) => sum + row.current, 0);
  const previousTotal = previous ? rows.reduce((sum, row) => sum + (row.previous ?? 0), 0) : null;
  const wholeTotal = previousWhole ? previousWhole.trends.reduce((sum, point) => sum + point[series], 0) : null;
  const peak = Math.max(0, ...rows.map((row) => row.current));
  const label = SERIES.find((item) => item.value === series)?.label ?? '';
  const summary = `${label}: ${periodLabel}, усього ${total}${previousTotal !== null ? `, попередній період ${previousTotal}` : ''}, найбільше значення ${peak}`;

  return (
    <SectionCard
      className={className}
      title="Динаміка за днями"
      note={points.length > MAX_POINTS ? `Дні об’єднані по ${Math.ceil(points.length / MAX_POINTS)}, суми не обрізаються.` : undefined}
      aside={<Legend hasPrevious={previous !== null} />}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Segmented<SeriesKey> label="Показник графіка" size="sm" value={series} onValueChange={setSeries} items={SERIES} />
        <p className="m-0 flex items-baseline gap-3 text-sm text-ink-2">
          <span><span className="font-mono text-[28px] leading-none tracking-[-0.03em] text-ink">{total}</span> разом</span>
          {previousTotal !== null ? <span>було <span className="font-mono text-ink">{previousTotal}</span></span> : null}
          {previousWhole && wholeTotal !== null ? <span className="text-xs">Весь {previousWhole.label}: <span className="font-mono text-ink">{wholeTotal}</span></span> : null}
        </p>
      </div>
      {total === 0 && !previousTotal ? (
        <EmptyState text="У цьому періоді за цим показником ще немає подій. Спробуй інший показник або довший період." />
      ) : (
        <figure aria-label={summary} className="m-0 h-[220px] w-full @2xl:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <pattern id={hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" strokeOpacity="0.22" strokeWidth="1" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={32} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={40} allowDecimals={false} />
              <Tooltip cursor={{ stroke: 'var(--line-strong)' }} content={(props) => <ChartTooltip active={props.active} row={props.payload?.[0]?.payload as Row | undefined} />} />
              {previous ? <Line dataKey="previous" type="monotone" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={!reduced} animationDuration={700} /> : null}
              <Area dataKey="current" type="monotone" stroke="var(--ink)" strokeWidth={1.5} fill={`url(#${hatch})`} dot={false} activeDot={{ r: 4, fill: 'var(--ink)', stroke: 'var(--field)', strokeWidth: 2 }} isAnimationActive={!reduced} animationDuration={700} />
            </ComposedChart>
          </ResponsiveContainer>
        </figure>
      )}
    </SectionCard>
  );
}
