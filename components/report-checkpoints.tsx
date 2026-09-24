'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportPublicationCorrection } from '@/components/report-publication-correction';
import { ReportLessonResultCorrection } from '@/components/report-lesson-result-correction';
import { ReportChatCorrection } from '@/components/report-chat-correction';
import { ReportSubjectAnalytics } from '@/components/report-subject-analytics';
import { ReportManualDiff } from '@/components/report-manual-diff';
import { WorkspaceInlineLoading } from '@/components/workspace-load-state';

type Checkpoint = {
  slot: '13:00' | '16:00' | '19:00';
  state: 'skipped' | 'upcoming' | 'due' | 'submitted';
  reason: string | null;
  submittedAt: number | null;
  text: string | null;
  version: number;
};

type Payload = { date: string; checkpoints: Checkpoint[]; error?: string };

export function ReportCheckpoints({ date }: { date: string }) {
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [loadedDate,setLoadedDate]=useState<string|null>(null);
  const cache=useRef(new Map<string,Checkpoint[]>());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/reports/checkpoints?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити проміжні звіти.');
      cache.current.set(date,body.checkpoints);setItems(body.checkpoints);setLoadedDate(date);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити проміжні звіти.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const cached=cache.current.get(date);
    if(cached){setItems(cached);setLoadedDate(date);}
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function submit(item: Checkpoint) {
    const slot = item.slot;
    setSaving(slot);
    setError('');
    try {
      const response = await fetch('/api/reports/checkpoints', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, slot, expectedVersion: item.version }),
      });
      const body = await response.json() as Payload & { text?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося здати проміжний звіт.');
      cache.current.set(date,body.checkpoints);setItems(body.checkpoints);setLoadedDate(date);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося здати проміжний звіт.');
    } finally {
      setSaving(null);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch { setError('Не вдалося скопіювати текст.'); }
  }

  return <>
    <section className="report-checkpoints" aria-label="Проміжні звіти" aria-busy={loading}>
      <div className="report-checkpoints-head"><div><p className="eyebrow">Контроль дня</p><h4>Проміжні звіти</h4></div><span className="muted-note">Час визначається від початку робочого дня.</span></div>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loading&&loadedDate!==date ? <WorkspaceInlineLoading label="Завантажуємо проміжні звіти…"/> : loadedDate===date&&items.length ? <div className="report-checkpoint-list">{items.map((item) => <div key={item.slot} className={`report-checkpoint is-${item.state}`}><div><strong><Clock3 />{item.slot}</strong><span>{statusText(item)}</span>{item.reason && <small>{item.reason}</small>}</div><div className="report-checkpoint-actions">{item.state === 'due' && <Button size="sm" onClick={() => void submit(item)} disabled={saving !== null}>{saving === item.slot ? 'Здаємо…' : 'Здати'}</Button>}{item.state === 'submitted' && item.text && <><Button size="sm" variant="outline" onClick={() => void copy(item.text!)}><Clipboard data-icon="inline-start" />Копіювати</Button><Check aria-label="Здано" /></>}</div></div>)}</div> : <p className="muted-note">Для цього дня проміжні звіти не потрібні.</p>}
    </section>
    <ReportSubjectAnalytics date={date} />
    <ReportManualDiff date={date} />
    <ReportPublicationCorrection date={date} />
    <ReportLessonResultCorrection date={date} />
    <ReportChatCorrection date={date} />
  </>;
}

function statusText(item: Checkpoint) {
  if (item.state === 'submitted') return item.submittedAt ? `Здано ${formatTime(item.submittedAt)}` : 'Здано';
  if (item.state === 'due') return 'Пора здати';
  if (item.state === 'upcoming') return 'Ще не настав';
  return 'Пропускається';
}
function formatTime(epoch: number) { return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(epoch * 1000)); }
