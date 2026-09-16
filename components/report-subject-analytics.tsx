'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SubjectAnalytics, SubjectPeriod } from '@/lib/reports/subjects';

const PERIODS: Array<{ key: SubjectPeriod; label: string }> = [
  { key: 'day', label: 'День' },
  { key: '7', label: '7 днів' },
  { key: '30', label: '30 днів' },
  { key: 'month', label: 'Місяць' },
  { key: 'all', label: 'Весь час' },
];

export function ReportSubjectAnalytics({ date }: { date: string }) {
  const [period, setPeriod] = useState<SubjectPeriod>('day');
  const [data, setData] = useState<SubjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch(`/api/reports/subjects?date=${encodeURIComponent(date)}&period=${period}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as SubjectAnalytics & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити статистику предметів.');
        if (!controller.signal.aborted) setData(body);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити статистику предметів.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date, period]);

  return (
    <section className="report-subjects" aria-labelledby="report-subjects-title">
      <div className="report-checkpoints-head">
        <div>
          <p className="eyebrow">Предмети</p>
          <h4 id="report-subjects-title">Відгуки та записи за предметами</h4>
          {data && <p className="muted-note">{periodLabel(data)}</p>}
        </div>
        <div className="lead-actions" role="group" aria-label="Період статистики предметів">
          {PERIODS.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={period === item.key ? 'secondary' : 'ghost'}
              aria-pressed={period === item.key}
              onClick={() => setPeriod(item.key)}
              disabled={loading && period === item.key}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loading && !data ? (
        <p className="muted-note">Завантажуємо предмети…</p>
      ) : data ? (
        <>
          <div className="report-subject-table hidden md:block" role="region" aria-label="Таблиця предметів" tabIndex={0}>
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold" scope="col">Предмет</th>
                  <th className="px-3 py-2.5 text-right font-semibold" scope="col">Відгуки</th>
                  <th className="px-3 py-2.5 text-right font-semibold" scope="col">Записи</th>
                  <th className="px-3 py-2.5 text-right font-semibold" scope="col">Конверсія</th>
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-normal" scope="col">Частка відгуків</th>
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-normal" scope="col">Частка записів</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length ? data.rows.map((row) => (
                  <tr className="border-t border-border" key={row.subject}>
                    <th className="px-3 py-2.5 text-left font-semibold" scope="row">{row.subject}</th>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.responses}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.bookings}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{percent(row.conversion, row.responses)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{percent(row.responseShare, data.total.responses)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{percent(row.bookingShare, data.total.bookings)}</td>
                  </tr>
                )) : (
                  <tr className="border-t border-border"><td className="px-3 py-4 text-muted-foreground" colSpan={6}>За цей період відгуків і записів немає.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20 font-semibold">
                  <th className="px-3 py-2.5 text-left" scope="row">Усього</th>
                  <td className="px-3 py-2.5 text-right tabular-nums">{data.total.responses}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{data.total.bookings}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{percent(data.total.conversion, data.total.responses)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{data.total.responses ? '100%' : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{data.total.bookings ? '100%' : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-2 grid gap-2 md:hidden" aria-label="Предмети за вибраний період">
            {data.rows.length ? data.rows.map((row) => (
              <article className="rounded-xl border border-border bg-card p-3" key={row.subject}>
                <h5 className="mb-3 text-sm font-semibold">{row.subject}</h5>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <SubjectMetric label="Відгуки" value={String(row.responses)} />
                  <SubjectMetric label="Записи" value={String(row.bookings)} />
                  <SubjectMetric label="Конверсія" value={percent(row.conversion, row.responses)} />
                  <SubjectMetric label="Частка відгуків" value={percent(row.responseShare, data.total.responses)} />
                  <SubjectMetric label="Частка записів" value={percent(row.bookingShare, data.total.bookings)} />
                </div>
              </article>
            )) : (
              <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">За цей період відгуків і записів немає.</p>
            )}
            <article className="rounded-xl border border-border bg-muted/30 p-3">
              <h5 className="mb-3 text-sm font-semibold">Усього</h5>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <SubjectMetric label="Відгуки" value={String(data.total.responses)} />
                <SubjectMetric label="Записи" value={String(data.total.bookings)} />
                <SubjectMetric label="Конверсія" value={percent(data.total.conversion, data.total.responses)} />
                <SubjectMetric label="Частка відгуків" value={data.total.responses ? '100%' : '—'} />
                <SubjectMetric label="Частка записів" value={data.total.bookings ? '100%' : '—'} />
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

function SubjectMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] leading-4 text-muted-foreground">{label}</span>
      <strong className="mt-0.5 block text-sm tabular-nums">{value}</strong>
    </div>
  );
}

function percent(value: number, denominator: number): string {
  return denominator > 0 ? `${value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%` : '—';
}

function periodLabel(data: SubjectAnalytics): string {
  if (!data.from) return `До ${formatDate(data.to)} включно`;
  if (data.from === data.to) return formatDate(data.to);
  return `${formatDate(data.from)} — ${formatDate(data.to)}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
