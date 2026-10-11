'use client';

import { CalendarCheck, GraduationCap, Reply, Send, type LucideIcon } from 'lucide-react';
import { Sparkline } from '@/components/ui/sparkline';
import { Tile, type TileDelta } from '@/components/ui/tile';
import { analyticsPercentLabel } from '@/lib/analytics-rate';
import { goalRatio } from '@/components/views/shared/pace';
import { sample, type AnalyticsData, type MetricKey, type PreviousWindow, type Totals } from './types';

type Kpi = { key: MetricKey; label: string; icon: LucideIcon; rate: keyof Targets; base: string; from: keyof Totals };
type Targets = AnalyticsData['targets'];

const KPIS: readonly Kpi[] = [
  { key: 'publications', label: 'Публікації', icon: Send, rate: 'publicationRate', base: 'від приєднань', from: 'joined' },
  { key: 'responses', label: 'Відгуки', icon: Reply, rate: 'responseRate', base: 'від публікацій', from: 'publications' },
  { key: 'bookings', label: 'Записи', icon: CalendarCheck, rate: 'bookingRate', base: 'від відгуків', from: 'responses' },
  { key: 'completed', label: 'Проведені уроки', icon: GraduationCap, rate: 'completionRate', base: 'від записів', from: 'bookings' },
];

/** Зміна до попереднього періоду; сигнальний колір лише для значущої: ≥ 3 одиниці і ≥ 20% (або з нуля). */
export function deltaOf(current: number, previous: number | undefined): TileDelta | undefined {
  if (previous === undefined) return undefined;
  const diff = current - previous;
  if (diff === 0) return { text: '→ без змін' };
  const ratio = previous > 0 ? Math.abs(diff) / previous : Infinity;
  const significant = Math.abs(diff) >= 3 && ratio >= 0.2;
  const text = `${diff > 0 ? '↑' : '↓'} ${previous > 0 ? `${Math.round(ratio * 100)}%` : `+${Math.abs(diff)}`}`;
  return { text, tone: significant ? (diff > 0 ? 'ok' : 'hot') : 'neutral' };
}

/** Чотири показники воронки: число, дельта до попереднього періоду, відсоток від попереднього кроку й ціль. */
export function KpiRow({ data, previous, onOpen }: { data: AnalyticsData; previous: PreviousWindow | null; onOpen: (metric: MetricKey) => void }) {
  return (
    <section aria-label="Показники періоду" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-4">
      {KPIS.map((kpi) => {
        const value = data.totals[kpi.key];
        const base = data.totals[kpi.from];
        const target = data.targets[kpi.rate];
        const rate = analyticsPercentLabel(data.totals[kpi.rate], base);
        const series = sample(data.trends.map((point) => point[kpi.key]), 48);
        return (
          <Tile
            key={kpi.key}
            label={kpi.label}
            value={value}
            icon={kpi.icon}
            delta={deltaOf(value, previous?.totals[kpi.key])}
            hint={`${rate} ${kpi.base}${target > 0 ? ` · ціль ${target}%` : ''}`}
            progress={target > 0 && base > 0 ? { value: goalRatio(data.totals[kpi.rate], target), tone: data.totals[kpi.rate] >= target ? 'ok' : 'hot' } : undefined}
            aside={series.length > 1 ? <Sparkline values={series} width={72} height={32} /> : undefined}
            onClick={() => onOpen(kpi.key)}
          />
        );
      })}
    </section>
  );
}
