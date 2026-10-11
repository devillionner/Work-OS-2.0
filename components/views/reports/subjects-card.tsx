'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Ghost } from '@/components/ui/ghost';
import { Segmented } from '@/components/ui/segmented';
import { BarRow, SectionCard } from '@/components/views/shared/card';
import { useRemote } from '@/components/views/shared/use-remote';
import { analyticsPercentLabel } from '@/lib/analytics-rate';
import type { SubjectAnalytics, SubjectPeriod } from '@/lib/reports/subjects';
import { formatDate } from './types';

const PERIODS: ReadonlyArray<{ value: SubjectPeriod; label: string }> = [
  { value: 'day', label: 'День' },
  { value: '7', label: '7 днів' },
  { value: '30', label: '30 днів' },
  { value: 'month', label: 'Місяць' },
  { value: 'all', label: 'Весь час' },
];

function periodLabel(data: SubjectAnalytics): string {
  if (!data.from) return `До ${formatDate(data.to)} включно`;
  return data.from === data.to ? formatDate(data.to) : `${formatDate(data.from)} — ${formatDate(data.to)}`;
}

/** Відгуки й записи за предметами відносно вибраного дня: день, 7/30 днів, місяць або весь час. */
export default function SubjectsCard({ date, active, className }: { date: string; active: boolean; className?: string }) {
  const [period, setPeriod] = useState<SubjectPeriod>('day');
  const [attempt, setAttempt] = useState(0);
  const { data, error, loading } = useRemote<SubjectAnalytics>(`/api/reports/subjects?date=${encodeURIComponent(date)}&period=${period}`, { refresh: attempt, enabled: active, keepPrevious: true, fallback: 'Не вдалося завантажити статистику предметів.' });

  return (
    <SectionCard title="Відгуки та записи за предметами" note={data ? periodLabel(data) : undefined} aside={<Segmented<SubjectPeriod> label="Період статистики предметів" size="sm" value={period} onValueChange={setPeriod} items={PERIODS} />} className={className}>
      {error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !data ? (
        <div aria-busy={loading} className="flex flex-col gap-3"><Ghost className="h-14 rounded-inner" /><Ghost className="h-14 rounded-inner" /><Ghost className="h-14 rounded-inner" /></div>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-3 gap-4">
            <div><dt className="text-xs text-ink-2">Відгуки</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{data.total.responses}</dd></div>
            <div><dt className="text-xs text-ink-2">Записи</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{data.total.bookings}</dd></div>
            <div><dt className="text-xs text-ink-2">Конверсія</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{analyticsPercentLabel(data.total.conversion, data.total.responses)}</dd></div>
          </dl>
          {data.rows.length === 0 ? (
            <EmptyState text="За цей період відгуків і записів немає." />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0 pt-1">
              {data.rows.map((row) => (
                <BarRow
                  key={row.subject}
                  label={row.subject}
                  sub={`${row.responses} відг. · ${row.bookings} зап. · ${analyticsPercentLabel(row.bookingShare, data.total.bookings)} записів`}
                  value={analyticsPercentLabel(row.conversion, row.responses)}
                  meta="у запис"
                  ratio={row.responseShare / 100}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
