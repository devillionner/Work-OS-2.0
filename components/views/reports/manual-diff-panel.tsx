'use client';

import { useState } from 'react';
import { Panel } from '@/components/shell/panel';
import { Button } from '@/components/ui/button';
import { Ghost } from '@/components/ui/ghost';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { labels } from '@/components/views/leads/client';
import { useRemote } from '@/components/views/shared/use-remote';
import type { ReportEventDetail } from '@/lib/reports/details';
import type { ReportManualAdjustments } from '@/lib/reports/manual-adjustments';
import { cn } from '@/lib/utils';
import { formatDate } from './types';
import { humanError } from '@/components/ui/human-error';

type Payload = {
  date: string;
  reportExists: boolean;
  revision: number | null;
  facts: ReportManualAdjustments;
  adjustments: ReportManualAdjustments;
  totals: ReportManualAdjustments;
  details: ReportEventDetail[];
  error?: string;
};
type MetricKey = keyof ReportManualAdjustments;

const METRICS: ReadonlyArray<{ key: MetricKey; label: string }> = [
  { key: 'publications', label: 'Оголошення' },
  { key: 'responses', label: 'Відгуки' },
  { key: 'bookings', label: 'Записи' },
];

function sourcesOf(key: MetricKey, details: ReportEventDetail[]): ReportEventDetail[] {
  if (key === 'publications') return details.filter((event) => event.eventType === 'publication');
  if (key === 'responses') return details.filter((event) => event.eventType === 'lead_created');
  return details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
}

/** Факт з подій і ручна корекція: двоколонкове порівняння; змінені рядки підсвічені --raised. */
export function ManualDiffPanel({ open, onOpenChange, date }: { open: boolean; onOpenChange: (open: boolean) => void; date: string }) {
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<{ key: string; value: ReportManualAdjustments } | null>(null);
  const [saved, setSaved] = useState<{ date: string; attempt: number; payload: Payload } | null>(null);
  const [saving, setSaving] = useState(false);
  const remote = useRemote<Payload>(`/api/reports/manual-adjustments?date=${encodeURIComponent(date)}`, { refresh: attempt, enabled: open, fallback: 'Не вдалося завантажити звірку чисел.' });
  const data = saved && saved.date === date && saved.attempt === attempt ? saved.payload : remote.data;
  const key = `${date}:${attempt}`;
  const values = draft && draft.key === key ? draft.value : data?.adjustments ?? { publications: 0, responses: 0, bookings: 0 };
  const invalid = data ? METRICS.some(({ key: metric }) => data.facts[metric] + values[metric] < 0) : false;
  const dirty = data ? METRICS.some(({ key: metric }) => values[metric] !== data.adjustments[metric]) : false;

  const update = (metric: MetricKey, raw: string) => {
    const next = Number(raw);
    if (!Number.isSafeInteger(next) || Math.abs(next) > 9999) return;
    setDraft({ key, value: { ...values, [metric]: next } });
  };

  const save = async () => {
    if (!data?.reportExists || data.revision === null || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/reports/manual-adjustments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, adjustments: values, expectedRevision: data.revision }) });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти ручну корекцію.');
      setSaved({ date, attempt, payload: body });
      setDraft(null);
      toast.push({ message: 'Ручну корекцію збережено окремо від подієвого факту.', tone: 'ok' });
    } catch (reason) {
      toast.push({ message: humanError(reason, 'Не вдалося зберегти ручну корекцію.'), tone: 'hot' });
      setSaved(null);
      setDraft(null);
      setAttempt((value) => value + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Факт і ручна корекція"
      subtitle={formatDate(date)}
      footer={data ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" disabled={saving || remote.loading} onClick={() => { setSaved(null); setDraft(null); setAttempt((value) => value + 1); }}>Оновити факт</Button>
          <Button variant="action" size="sm" disabled={!data.reportExists || data.revision === null || saving || invalid || !dirty} busy={saving} onClick={() => void save()}>{saving ? 'Зберігаємо…' : 'Зберегти корекцію'}</Button>
        </div>
      ) : undefined}
    >
      {remote.error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="m-0 text-sm text-hot">{remote.error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</Button>
        </div>
      ) : !data ? (
        <div aria-busy="true" className="flex flex-col gap-3"><Ghost className="h-5 w-3/4 rounded-full" /><Ghost className="h-36 rounded-inner" /><Ghost className="h-36 rounded-inner" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="m-0 text-[13px] text-ink-2">Авто-числа беруться з подій. Корекція зберігається лише у звіті як явна різниця; «Сьогодні» й «Аналітика» від неї не змінюються.</p>
          {!data.reportExists ? <p role="alert" className="m-0 text-sm text-hot">Спочатку збережи чернетку звіту — після цього корекцію можна буде зафіксувати окремо.</p> : null}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_96px_auto] items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            <span />
            <span className="text-right">Авто-факт</span>
            <span>Корекція</span>
            <span className="text-right">Звіт</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {METRICS.map(({ key: metric, label }) => {
              const sources = sourcesOf(metric, data.details);
              const total = data.facts[metric] + values[metric];
              const changed = values[metric] !== 0;
              return (
                <li key={metric} className={cn('rounded-inner border border-line p-3', changed && 'bg-raised')}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_96px_auto] items-center gap-x-3">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-right font-mono text-[15px]">{data.facts[metric]}</span>
                    <Input type="number" inputMode="numeric" aria-label={`Ручна корекція: ${label}`} min={-data.facts[metric]} max={9999} step={1} value={values[metric]} disabled={!data.reportExists || saving} onChange={(event) => update(metric, event.target.value)} className="h-9 px-3 text-right font-mono" />
                    <span className="text-right font-mono text-[15px]">{total}</span>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Джерела авто-факту ({sources.length})</summary>
                    {sources.length === 0 ? (
                      <p className="m-0 mt-2 text-xs text-ink-2">Активних джерел немає.</p>
                    ) : (
                      <ul className="m-0 mt-2 flex list-none flex-col p-0">
                        {sources.map((item) => (
                          <li key={item.id} className="border-t border-line py-2 first:border-t-0">
                            <p className="m-0 truncate text-sm">{item.eventType === 'publication' ? item.chatName || 'Чат недоступний' : item.leadName || 'Лід недоступний'}</p>
                            <p className="m-0 truncate text-xs text-ink-2">{labels[item.platform || ''] ?? item.platform ?? 'Платформа не вказана'}{item.lessonSubject || item.leadSubject ? ` · ${item.lessonSubject || item.leadSubject}` : ''}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
          {invalid ? <p role="alert" className="m-0 text-sm text-hot">Підсумкове число не може бути від’ємним.</p> : null}
        </div>
      )}
    </Panel>
  );
}
