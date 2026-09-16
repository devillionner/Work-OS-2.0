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
        <div className="report-subject-table" role="region" aria-label="Таблиця предметів" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Предмет</th>
                <th scope="col">Відгуки</th>
                <th scope="col">Записи</th>
                <th scope="col">Конверсія</th>
                <th scope="col">Частка відгуків</th>
                <th scope="col">Частка записів</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length ? data.rows.map((row) => (
                <tr key={row.subject}>
                  <th scope="row">{row.subject}</th>
                  <td>{row.responses}</td>
                  <td>{row.bookings}</td>
                  <td>{percent(row.conversion, row.responses)}</td>
                  <td>{percent(row.responseShare, data.total.responses)}</td>
                  <td>{percent(row.bookingShare, data.total.bookings)}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}>За цей період відгуків і записів немає.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Усього</th>
                <td>{data.total.responses}</td>
                <td>{data.total.bookings}</td>
                <td>{percent(data.total.conversion, data.total.responses)}</td>
                <td>{data.total.responses ? '100%' : '—'}</td>
                <td>{data.total.bookings ? '100%' : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </section>
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
