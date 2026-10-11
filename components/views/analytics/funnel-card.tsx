import { analyticsPercentLabel } from '@/lib/analytics-rate';
import { cn } from '@/lib/utils';
import { SectionCard } from '@/components/views/shared/card';
import type { AnalyticsData, Targets, Totals } from './types';

type Step = { key: keyof Totals; label: string; rate?: keyof Targets; from?: keyof Totals; unit: string };

const STEPS: readonly Step[] = [
  { key: 'joined', label: 'Приєднані чати', unit: 'старт' },
  { key: 'publications', label: 'Публікації', rate: 'publicationRate', from: 'joined', unit: 'від приєднань' },
  { key: 'responses', label: 'Відгуки', rate: 'responseRate', from: 'publications', unit: 'конверсія' },
  { key: 'bookings', label: 'Записи', rate: 'bookingRate', from: 'responses', unit: 'конверсія' },
  { key: 'completed', label: 'Проведені', rate: 'completionRate', from: 'bookings', unit: 'доходимість' },
];

const OUTCOMES: ReadonlyArray<{ key: keyof AnalyticsData['outcomes']; label: string }> = [
  { key: 'booked', label: 'Записано' },
  { key: 'completed', label: 'Проведено' },
  { key: 'cancelled', label: 'Скасовано' },
  { key: 'rescheduled', label: 'Перенесено' },
  { key: 'noShow', label: 'Не прийшов' },
];

/** Де втрачається результат: воронка за датою події і результат уроків у тому ж періоді. */
export function FunnelCard({ data, className }: { data: AnalyticsData; className?: string }) {
  const peak = Math.max(1, ...STEPS.map((step) => data.totals[step.key]));
  return (
    <SectionCard className={className} title="Де втрачається результат" note="Активність за датою події. Червоним позначено крок, де конверсія нижча за задану ціль.">
      <ol className="m-0 flex list-none flex-col p-0">
        {STEPS.map((step) => {
          const value = data.totals[step.key];
          const base = step.from ? data.totals[step.from] : 0;
          const rate = step.rate ? data.totals[step.rate] : null;
          const target = step.rate ? data.targets[step.rate] : 0;
          const below = rate !== null && target > 0 && base > 0 && rate < target;
          return (
            <li key={step.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0">
              <p className="m-0 truncate text-sm">{step.label}</p>
              <p className="m-0 text-right font-mono text-[15px]">{value}</p>
              <div aria-hidden="true" className="col-span-2 h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${value / peak})`, transition: 'transform 0.32s var(--ease-out)' }} />
              </div>
              <p className={cn('col-span-2 m-0 text-xs', below ? 'text-hot' : 'text-ink-2')}>
                {rate === null ? step.unit : `${analyticsPercentLabel(rate, base)} ${step.unit}${target > 0 ? ` · ціль ${target}%` : ''}`}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="m-0 text-sm font-medium">Результат уроків</h3>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-5">
          {OUTCOMES.map((outcome) => (
            <div key={outcome.key} className="min-w-0">
              <dt className="truncate text-xs text-ink-2">{outcome.label}</dt>
              <dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{data.outcomes[outcome.key]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}
