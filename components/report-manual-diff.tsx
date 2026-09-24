'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReportEventDetail } from '@/lib/reports/details';
import type { ReportManualAdjustments } from '@/lib/reports/manual-adjustments';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

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
const metrics: Array<{ key: MetricKey; label: string }> = [
  { key: 'publications', label: 'Оголошення' },
  { key: 'responses', label: 'Відгуки' },
  { key: 'bookings', label: 'Записи' },
];
const platformNames: Record<string, string> = {
  telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', facebook: 'Facebook', threads: 'Threads', unknown: 'Інше',
};

export function ReportManualDiff({ date }: { date: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<ReportManualAdjustments>({ publications: 0, responses: 0, bookings: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/reports/manual-adjustments?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити звірку чисел.');
      setData(body);
      setDraft(body.adjustments);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити звірку чисел.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function update(key: MetricKey, value: string) {
    const next = Number(value);
    if (!Number.isSafeInteger(next) || Math.abs(next) > 9999) return;
    setDraft((current) => ({ ...current, [key]: next }));
    setNotice('');
  }

  async function save() {
    if (!data?.reportExists || data.revision === null || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/reports/manual-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, adjustments: draft, expectedRevision: data.revision }),
      });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти ручну корекцію.');
      setData(body);
      setDraft(body.adjustments);
      setNotice('Ручну корекцію збережено окремо від подієвого факту.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти ручну корекцію.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  const invalidTotal = data ? metrics.some(({ key }) => data.facts[key] + draft[key] < 0) : false;

  return <section className="report-checkpoints" aria-label="Звірка автоматичних і ручних чисел" aria-busy={loading}>
    <div className="report-checkpoints-head">
      <div><p className="eyebrow">REPORT-22</p><h4>Факт і ручна корекція</h4></div>
      <span className="muted-note">Подієвий факт не переписується.</span>
    </div>
    <p className="muted-note">Авто-числа походять з activity events. Корекція зберігається лише у звіті як явна різниця; Today та Analytics від неї не змінюються.</p>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {notice && <output className="reports-notice">{notice}</output>}
    {loading && !data ? <WorkspaceInlineLoading label="Завантажуємо звірку…"/> : data ? <>
      {!data.reportExists && <p className="workspace-error">Спочатку збережіть чернетку звіту — після цього ручну корекцію можна буде зафіксувати окремо.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {metrics.map(({ key, label }) => {
          const sources = metricSources(key, data.details);
          const total = data.facts[key] + draft[key];
          return <article key={key} className="rounded-xl border border-border/70 bg-muted/20 p-3">
            <strong className="block">{label}</strong>
            <div className="mt-2 grid gap-2 text-sm">
              <span>Авто-факт: <strong>{data.facts[key]}</strong></span>
              <label className="grid gap-1">Ручна корекція
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label={`Ручна корекція: ${label}`}
                  min={-data.facts[key]}
                  max={9999}
                  step={1}
                  value={draft[key]}
                  disabled={!data.reportExists || saving}
                  onChange={(event) => update(key, event.target.value)}
                />
              </label>
              <span>Підсумок звіту: <strong>{total}</strong></span>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">Джерела авто-факту ({sources.length})</summary>
              <SourceList items={sources} />
            </details>
          </article>;
        })}
      </div>
      {invalidTotal && <p className="workspace-error" role="alert">Підсумкове число не може бути від’ємним.</p>}
      <div className="reports-editor-actions">
        <Button variant="outline" onClick={() => void load()} disabled={saving||loading}>{loading?'Оновлюємо…':'Оновити факт'}</Button>
        <Button onClick={() => void save()} disabled={!data.reportExists || data.revision === null || saving || invalidTotal}>
          {saving ? 'Зберігаємо…' : 'Зберегти корекцію'}
        </Button>
      </div>
    </> : null}
  </section>;
}

function metricSources(key: MetricKey, details: ReportEventDetail[]): ReportEventDetail[] {
  if (key === 'publications') return details.filter((event) => event.eventType === 'publication');
  if (key === 'responses') return details.filter((event) => event.eventType === 'lead_created');
  return details.filter((event) => event.eventType === 'lesson_booked' || event.eventType === 'curator_booking_pending');
}

function SourceList({ items }: { items: ReportEventDetail[] }) {
  if (!items.length) return <p className="muted-note mt-2">Активних джерел немає.</p>;
  return <ul className="mt-2 grid gap-2 text-sm">{items.map((item) => {
    const platform = platformNames[item.platform || 'unknown'] || item.platform || 'Платформа не вказана';
    const primary = item.eventType === 'publication'
      ? item.chatName || 'Чат недоступний'
      : item.leadName || 'Лід недоступний';
    const subject = item.lessonSubject || item.leadSubject;
    return <li key={item.id} className="rounded-lg border border-border/60 px-2.5 py-2">
      <strong className="block">{primary}</strong>
      <span className="text-muted-foreground">{platform}{subject ? ` · ${subject}` : ''}</span>
    </li>;
  })}</ul>;
}
