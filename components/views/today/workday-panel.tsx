'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Surface } from '@/components/ui/surface';
import type { WorkdaySnapshot } from '@/lib/workday';
import { humanError } from '@/components/ui/human-error';

type WorkdayResponse = { workday?: WorkdaySnapshot | null; today?: string; error?: string; requiresConfirmation?: boolean; unfinishedCount?: number };
const SYNC_CHANNEL = 'work-os-workday';

/**
 * Робочий день: привітання, активний час і велика pill-кнопка стану. Дані приходять зі знімка «Сьогодні»;
 * додатково перечитуються лише коли застосунок знову стає видимим, відновлюється мережа або інша вкладка
 * повідомляє про зміну. Жодного опитування за таймером.
 */
export function WorkdayPanel({ greeting, dateLabel }: { greeting: string; dateLabel: string }) {
  const { snapshot } = useShell();
  const [workday, setWorkday] = useState<WorkdaySnapshot | null>(snapshot.workday);
  const [currentToday, setCurrentToday] = useState(snapshot.today);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const busyRef = useRef(false);
  const syncingRef = useRef(false);
  const generation = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signature = useRef(workdaySignature(snapshot.workday, snapshot.today));

  // Новий знімок «Сьогодні» (live-канал, повернення у вкладку) — єдине джерело правди, коли відрізняється.
  useEffect(() => {
    const next = workdaySignature(snapshot.workday, snapshot.today);
    if (next === signature.current || busyRef.current) return;
    signature.current = next;
    queueMicrotask(() => {
      setWorkday(snapshot.workday);
      setCurrentToday(snapshot.today);
      setNow(snapshot.workday?.asOf ?? Math.floor(Date.now() / 1000));
    });
  }, [snapshot.workday, snapshot.today]);

  useEffect(() => {
    if (workday?.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [workday?.status]);

  const refresh = useCallback(async () => {
    if (busyRef.current || syncingRef.current) return;
    syncingRef.current = true;
    const start = generation.current;
    try {
      const response = await fetch('/api/workday', { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const result = await response.json() as WorkdayResponse;
      if (start !== generation.current || busyRef.current) return;
      const next = result.workday ?? null;
      const nextToday = result.today || snapshot.today;
      signature.current = workdaySignature(next, nextToday);
      setWorkday(next);
      setCurrentToday(nextToday);
      setNow(next?.asOf ?? Math.floor(Date.now() / 1000));
    } catch { /* наступне повернення у вкладку повторить спробу */ } finally {
      syncingRef.current = false;
    }
  }, [snapshot.today]);

  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = wake;
    }
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [refresh]);

  const seconds = workday ? workday.activeSeconds + (workday.status === 'active' ? Math.max(0, now - workday.asOf) : 0) : 0;
  const staleOpen = Boolean(workday && workday.status !== 'ended' && workday.workDate !== currentToday);
  const showPlan = !workday || workday.workDate === currentToday;
  const plan = workday?.plan ?? { dailyGoal: snapshot.bookingGoal.target, monthlyGoal: snapshot.monthlyBookingGoal, focusDirections: snapshot.focusDirections, createdAt: 0 };

  async function mutate(action: 'start' | 'pause' | 'resume' | 'reopen' | 'reset' | 'end', confirmIncomplete = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    generation.current += 1;
    setBusy(true);
    setError('');
    let refreshAfter = false;
    try {
      const payload: Record<string, unknown> = { action };
      if (workday && action !== 'start') Object.assign(payload, { id: workday.id, workDate: workday.workDate, expectedVersion: workday.version, confirmIncomplete });
      const response = await fetch('/api/workday', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json() as WorkdayResponse;
      if (!response.ok) {
        if (result.requiresConfirmation) { setConfirmCount(result.unfinishedCount ?? snapshot.leadTaskCount); return; }
        refreshAfter = response.status === 409;
        throw new Error(result.error || 'Не вдалося оновити робочий день.');
      }
      if (action === 'reset') {
        if (result.workday !== null) throw new Error('Сервер не підтвердив скидання робочого дня.');
        generation.current += 1;
        setWorkday(null);
        setCurrentToday(result.today || snapshot.today);
        signature.current = workdaySignature(null, result.today || snapshot.today);
        setNow(Math.floor(Date.now() / 1000));
        setConfirmCount(null);
        setResetOpen(false);
        channelRef.current?.postMessage({ type: 'workday-changed', version: null });
        return;
      }
      if (!result.workday) throw new Error('Сервер не повернув стан робочого дня.');
      generation.current += 1;
      setWorkday(result.workday);
      signature.current = workdaySignature(result.workday, currentToday);
      setNow(result.workday.asOf);
      setConfirmCount(null);
      channelRef.current?.postMessage({ type: 'workday-changed', version: result.workday.version });
    } catch (reason) {
      setError(humanError(reason, 'Не вдалося оновити робочий день.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (refreshAfter) void refresh();
    }
  }

  const statusText = !workday ? 'Готово до старту' : workday.status === 'active' ? 'Триває' : workday.status === 'paused' ? 'Пауза' : `Завершено о ${formatTime(workday.endedAt)}`;

  return (
    <Surface variant="glass" radius="card" data-reveal className="flex flex-col justify-between gap-8 p-6 sm:p-8" aria-labelledby="workday-title">
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[13px] text-ink-2">{dateLabel}</p>
        <h2 id="workday-title" className="m-0 text-[clamp(32px,5vw,48px)] font-normal leading-[1.05] tracking-[-0.035em]">{greeting}</h2>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="m-0 text-[13px] text-ink-2">Активний час</p>
            <p className="m-0 font-mono text-[40px] font-normal leading-none tracking-[-0.03em]" aria-live="off">{formatDuration(seconds)}</p>
          </div>
          <p className="m-0 flex items-center gap-2 pb-1 text-sm text-ink-2" aria-live="polite">
            <i aria-hidden="true" className={`size-2 rounded-full ${workday?.status === 'active' ? 'bg-ok' : workday?.status === 'paused' ? 'bg-warn' : 'bg-line-strong'}`} />
            {statusText}
          </p>
        </div>

        {staleOpen ? <output className="block rounded-inner border border-warn/40 px-4 py-3 text-sm">Відкритий день за {formatDate(workday!.workDate)}. Заверши його перед стартом нового.</output> : null}
        {confirmCount !== null ? <output className="block rounded-inner border border-warn/40 px-4 py-3 text-sm">Залишилося справ: {confirmCount}. Завершити день попри це?</output> : null}
        {workday?.status === 'ended' ? <p className="m-0 text-sm text-ink-2">Завершили випадково? Поверни день і продовжиш із попереднього часу або скинь сьогоднішній, щоб почати заново.</p> : null}
        {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2.5">
          {!workday ? <Button variant="action" size="xl" busy={busy} onClick={() => void mutate('start')}><Play aria-hidden="true" strokeWidth={1.5} />Почати день</Button> : null}
          {workday?.status === 'active' ? <Button variant="outline" size="xl" busy={busy} onClick={() => void mutate('pause')}><Pause aria-hidden="true" strokeWidth={1.5} />Пауза</Button> : null}
          {workday?.status === 'paused' ? <Button variant="action" size="xl" busy={busy} onClick={() => void mutate('resume')}><Play aria-hidden="true" strokeWidth={1.5} />Продовжити</Button> : null}
          {workday && workday.status !== 'ended' && confirmCount === null ? <Button variant="ghost" size="xl" busy={busy} onClick={() => void mutate('end')}><Square aria-hidden="true" strokeWidth={1.5} />Завершити день</Button> : null}
          {confirmCount !== null ? (
            <>
              <Button variant="action" size="lg" busy={busy} onClick={() => void mutate('end', true)}>Завершити попри {confirmCount}</Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => setConfirmCount(null)}>Не завершувати</Button>
            </>
          ) : null}
          {workday?.status === 'ended' ? <Button variant="outline" size="xl" busy={busy} onClick={() => void mutate('reopen')}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Повернути день</Button> : null}
          {workday?.status === 'ended' && workday.workDate === currentToday ? <Button variant="outline" tone="danger" size="xl" disabled={busy} onClick={() => setResetOpen(true)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Скинути день</Button> : null}
        </div>

        {showPlan && workday?.plan ? (
          <p className="m-0 text-[13px] text-ink-2">
            Ціль дня зафіксовано о {formatTime(workday.plan.createdAt)}: записи <span className="font-mono text-ink">{plan.dailyGoal}</span> · місяць <span className="font-mono text-ink">{plan.monthlyGoal}</span> · <span className="text-ink">{plan.focusDirections.length ? plan.focusDirections.join(', ') : 'усі напрямки'}</span>
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Скинути робочий день?"
        description="Активний час і запис робочого дня за сьогодні буде видалено, після цього день можна почати заново. Ліди, чати, уроки та звіти не видаляються. Цю дію не можна скасувати."
        confirmLabel="Скинути день"
        busy={busy}
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void mutate('reset')}
      />
    </Surface>
  );
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
function formatTime(value: number | null) {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value * 1000));
}
function workdaySignature(value: WorkdaySnapshot | null, today: string) {
  return value ? [today, value.id, value.workDate, value.status, value.version, value.activeSince, value.pausedAt, value.endedAt, value.plan?.createdAt ?? ''].join(':') : `${today}:idle`;
}
