import { EmptyState } from '@/components/ui/empty-state';
import { analyticsPercentLabel } from '@/lib/analytics-rate';
import { AnalyticsCard, BarRow } from './card';
import type { SubjectData } from './types';

/** Напрямки попиту: частка відгуків за предметом, записи й конверсія у запис. */
export function SubjectsCard({ data, className }: { data: SubjectData; className?: string }) {
  return (
    <AnalyticsCard className={className} title="Предмети" note="Відгуки та записи за вибраний період; смужка — частка в усіх відгуках.">
      <dl className="m-0 grid grid-cols-3 gap-4">
        <div><dt className="text-xs text-ink-2">Відгуки</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{data.total.responses}</dd></div>
        <div><dt className="text-xs text-ink-2">Записи</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{data.total.bookings}</dd></div>
        <div><dt className="text-xs text-ink-2">Конверсія</dt><dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{analyticsPercentLabel(data.total.conversion, data.total.responses)}</dd></div>
      </dl>
      {data.rows.length === 0 ? (
        <EmptyState text="За цей період ще немає відгуків або записів із вказаним предметом." />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 pt-1">
          {data.rows.map((row) => (
            <BarRow
              key={row.subject}
              label={row.subject}
              sub={`${row.responses} відг. · ${row.bookings} зап.`}
              value={analyticsPercentLabel(row.conversion, row.responses)}
              meta="у запис"
              ratio={row.responseShare / 100}
            />
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}
