'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { analyticsPercentLabel } from '@/lib/analytics-rate';
import { SectionCard } from '@/components/views/shared/card';
import { formatPercent, type AnalyticsData } from './types';

type Column = { label: string; title: string };
type HeatRow = { id: string; label: string; sub: string; cells: Array<number | null>; strong?: boolean };

const CHAT_LIMIT = 8;
const PLATFORM_COLUMNS: readonly Column[] = [
  { label: 'Запис', title: 'Ліди із записом від усіх лідів' },
  { label: 'Урок', title: 'Проведені уроки від записів' },
  { label: 'Неявка', title: 'Неявки від записів' },
];
const CHAT_COLUMNS: readonly Column[] = [
  { label: 'Відгук', title: 'Унікальні відгуки від публікацій' },
  ...PLATFORM_COLUMNS,
];

const rate = (value: number, denominator: number) => (denominator > 0 ? value : null);

/** Теплова карта в монохромній шкалі прозорості --ink: яскравість клітинки відносна до найвищого значення колонки. */
function Heatmap({ columns, rows, label }: { columns: readonly Column[]; rows: HeatRow[]; label: string }) {
  const peaks = columns.map((_, index) => Math.max(0, ...rows.map((row) => row.cells[index] ?? 0)));
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table aria-label={label} className="w-full min-w-[340px] table-fixed border-separate border-spacing-1 text-sm">
        <colgroup><col className="w-[38%]" />{columns.map((column) => <col key={column.label} />)}</colgroup>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Назва</span></th>
            {columns.map((column) => <th key={column.label} scope="col" title={column.title} className="px-1 pb-1 text-center text-xs font-medium text-ink-2">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                <span className={row.strong ? 'block truncate font-medium' : 'block truncate'} title={row.label}>{row.label}</span>
                <span className="block truncate text-xs text-ink-2">{row.sub}</span>
              </th>
              {row.cells.map((value, index) => (
                <td
                  key={columns[index].label}
                  className={value === null ? 'h-11 rounded-field bg-sunken text-center font-mono text-[13px] text-ink-2' : 'h-11 rounded-field text-center font-mono text-[13px]'}
                  style={value === null ? undefined : { background: `color-mix(in srgb, var(--ink) ${Math.round(4 + (peaks[index] > 0 ? value / peaks[index] : 0) * 26)}%, transparent)` }}
                >
                  {value === null ? '—' : formatPercent(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Що сталося з відгуками періоду: когорта за датою отримання ліда, по платформах і по чатах-джерелах. */
export function CohortCard({ cohort, className }: { cohort: AnalyticsData['cohort']; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const totals = cohort.totals;
  const platformRows: HeatRow[] = [
    { id: 'all', label: 'Усі платформи', sub: `${totals.leads} лідів`, strong: true, cells: [rate(totals.bookingLeadRate, totals.leads), rate(totals.completionRate, totals.bookings), rate(totals.noShowRate, totals.bookings)] },
    ...cohort.platforms.map((row) => ({ id: row.key, label: row.name, sub: `${row.leads} лідів · ${row.bookings} зап.`, cells: [rate(row.bookingLeadRate, row.leads), rate(row.completionRate, row.bookings), rate(row.noShowRate, row.bookings)] })),
  ];
  const chatRows: HeatRow[] = cohort.chats.map((row) => ({
    id: row.id,
    label: row.name,
    sub: `${row.platformName} · ${row.publications} публ. · ${row.leads} відг. · ${row.bookings} зап.`,
    cells: [rate(row.leadRate, row.publications), rate(row.bookingLeadRate, row.leads), rate(row.completionRate, row.bookings), rate(row.noShowRate, row.bookings)],
  }));
  const shownChats = expanded ? chatRows : chatRows.slice(0, CHAT_LIMIT);

  return (
    <SectionCard className={className} title="Що сталося з відгуками" note="Когорта лідів за датою отримання відгуку; пізніші записи й уроки лишаються за початковим чатом-джерелом.">
      {totals.leads === 0 ? (
        <EmptyState text="У цьому періоді ще немає відгуків — когорти з’являться, коли надійдуть перші ліди." />
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-4">
            {[
              ['Ліди', totals.leads, 'активні відгуки періоду'],
              ['Із записом', totals.bookedLeads, `${analyticsPercentLabel(totals.bookingLeadRate, totals.leads)} лідів`],
              ['Усі записи', totals.bookings, 'включно з пізнішими'],
              ['Проведені', totals.completed, `${analyticsPercentLabel(totals.completionRate, totals.bookings)} від записів`],
            ].map(([label, value, hint]) => (
              <div key={String(label)} className="min-w-0">
                <dt className="truncate text-xs text-ink-2">{label}</dt>
                <dd className="m-0 font-mono text-[22px] leading-tight tracking-[-0.02em]">{value}</dd>
                <dd className="m-0 truncate text-xs text-ink-2">{hint}</dd>
              </div>
            ))}
          </dl>
          <Heatmap label="Когорти за платформами" columns={PLATFORM_COLUMNS} rows={platformRows} />
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="m-0 text-sm font-medium">Чати-джерела</h3>
            {chatRows.length === 0 ? (
              <EmptyState text="Для лідів цього періоду ще немає чатів-джерел." />
            ) : (
              <>
                <Heatmap label="Когорти за чатами-джерелами" columns={CHAT_COLUMNS} rows={shownChats} />
                {chatRows.length > CHAT_LIMIT ? (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? 'Згорнути' : `Показати всі (${chatRows.length})`}
                  </Button>
                ) : null}
              </>
            )}
          </div>
          <p className="m-0 text-xs text-ink-2">Колонки: Відгук — відгуки від публікацій · Запис — ліди із записом від відгуків · Урок — проведені від записів · Неявка — не прийшли від записів. Яскравість відносна в межах колонки.</p>
        </>
      )}
    </SectionCard>
  );
}
