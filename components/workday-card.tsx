'use client';

import { useEffect, useState } from 'react';
import { Clock3, Pause, Play, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WorkdaySnapshot } from '@/lib/workday';

type Props = {
  initial: WorkdaySnapshot | null;
  today: string;
  unfinishedCount: number;
  dailyGoal: number;
  monthlyGoal: number;
  focusDirections: string[];
};

type MutationResponse = {
  workday?: WorkdaySnapshot;
  error?: string;
  requiresConfirmation?: boolean;
  unfinishedCount?: number;
};

export function WorkdayCard({ initial, today, unfinishedCount, dailyGoal, monthlyGoal, focusDirections }: Props) {
  const [workday, setWorkday] = useState(initial);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  useEffect(() => {
    if (workday?.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [workday?.status]);

  const seconds = workday
    ? workday.activeSeconds + (workday.status === 'active' ? Math.max(0, now - workday.asOf) : 0)
    : 0;
  const staleOpen = Boolean(workday && workday.status !== 'ended' && workday.workDate !== today);

  async function mutate(action: 'start' | 'pause' | 'resume' | 'end', confirmIncomplete = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const payload: Record<string, unknown> = { action };
      if (workday && action !== 'start') Object.assign(payload, {
        id: workday.id, workDate: workday.workDate,
        expectedVersion: workday.version, confirmIncomplete,
      });
      const response = await fetch('/api/workday', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as MutationResponse;
      if (!response.ok) {
        if (result.requiresConfirmation) {
          setConfirmCount(result.unfinishedCount ?? unfinishedCount);
          return;
        }
        throw new Error(result.error || 'Не вдалося оновити робочий день.');
      }
      if (!result.workday) throw new Error('Сервер не повернув стан робочого дня.');
      setWorkday(result.workday);
      setNow(result.workday.asOf);
      setConfirmCount(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося оновити робочий день.');
    } finally { setBusy(false); }
  }

  return (
    <section className="workday-card" aria-labelledby="workday-title">
      <div className="workday-icon"><Clock3 /></div>
      <div>
        <p className="eyebrow">Робочий день</p>
        <h2 id="workday-title">{workday ? statusLabel(workday.status) : 'Ще не розпочато'}</h2>
        <p>Активний час: <strong>{formatDuration(seconds)}</strong></p>
        {staleOpen && <p className="muted-note">Відкритий день за {formatDate(workday!.workDate)}. Заверши його перед стартом нового.</p>}
        {confirmCount !== null && <p className="muted-note">Залишилося справ: {confirmCount}. Завершити день попри це?</p>}
        {workday?.workDate === today && <div className="workday-plan"><strong>План дня</strong><span>Записи: {dailyGoal} · місячна ціль: {monthlyGoal}</span><span>Фокус: {focusDirections.length ? focusDirections.join(', ') : 'без окремого напрямку'}</span></div>}
        {error && <p className="lead-error" role="alert">{error}</p>}
      </div>
      <div className="workday-actions">
        {!workday && <Button onClick={() => mutate('start')} disabled={busy}><Play data-icon="inline-start" />Почати день</Button>}
        {workday?.status === 'active' && <Button variant="outline" onClick={() => mutate('pause')} disabled={busy}><Pause data-icon="inline-start" />Пауза</Button>}
        {workday?.status === 'paused' && <Button variant="outline" onClick={() => mutate('resume')} disabled={busy}><Play data-icon="inline-start" />Продовжити</Button>}
        {workday && workday.status !== 'ended' && confirmCount === null && <Button variant="outline" onClick={() => mutate('end')} disabled={busy}><Square data-icon="inline-start" />Завершити день</Button>}
        {confirmCount !== null && <>
          <Button onClick={() => mutate('end', true)} disabled={busy}>Завершити попри {confirmCount}</Button>
          <Button variant="outline" onClick={() => setConfirmCount(null)} disabled={busy}>Не завершувати</Button>
        </>}
        {workday?.status === 'ended' && <Badge variant="secondary">Завершено {formatTime(workday.endedAt)}</Badge>}
      </div>
    </section>
  );
}

function statusLabel(status: WorkdaySnapshot['status']) {
  return status === 'active' ? 'Робота триває' : status === 'paused' ? 'На паузі' : 'День завершено';
}
function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
function formatTime(value: number | null) {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv',
  }).format(new Date(value * 1000));
}
