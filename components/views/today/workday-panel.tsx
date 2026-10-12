'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ellipsis, Pause, Play, RotateCcw, Square, Target, Trash2 } from 'lucide-react';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Surface } from '@/components/ui/surface';
import type { WorkdaySnapshot } from '@/lib/workday';
import { humanError } from '@/components/ui/human-error';

type WorkdayResponse = { workday?: WorkdaySnapshot | null; today?: string; error?: string; requiresConfirmation?: boolean; unfinishedCount?: number };
const SYNC_CHANNEL = 'work-os-workday';

export type WorkdayStatus = { started: boolean; ended: boolean; busy: boolean };

/**
 * Робочий день: компактна шапка в один рядок — привітання, активний час, стан і одна головна дія за станом дня (до старту
 * її немає: «Почати день» живе першим рядком «Що зробити зараз»). Дані приходять зі знімка «Сьогодні»;
 * додатково перечитуються лише коли застосунок знову стає видимим, відновлюється мережа або інша вкладка
 * повідомляє про зміну. Жодного опитування за таймером.
 */
export function WorkdayPanel({ greeting, dateLabel, startRef, onStatusChange, onOpenGoals }: {
  greeting: string;
  dateLabel: string;
  /** Дає списку «Що зробити зараз» той самий виклик старту: до старту дня головна кнопка лише там, одна на екрані. */
  startRef?: { current: (() => void) | null };
  onStatusChange?: (status: WorkdayStatus) => void;
  onOpenGoals: () => void;
}) {
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

  useEffect(() => {
    if (startRef) startRef.current = () => { void mutate('start'); };
    return () => { if (startRef) startRef.current = null; };
  });

  const started = workday !== null;
  const ended = workday?.status === 'ended';
  useEffect(() => { onStatusChange?.({ started, ended, busy }); }, [started, ended, busy, onStatusChange]);

  const statusText = !workday ? 'Готово до старту' : workday.status === 'active' ? 'Триває' : workday.status === 'paused' ? 'Пауза' : `Завершено о ${formatTime(workday.endedAt)}`;
  const canReset = workday?.status === 'ended' && workday.workDate === currentToday;

  return (
    <Surface variant="glass" radius="card" data-reveal className="flex flex-col gap-3 px-5 py-4 sm:px-6" aria-labelledby="workday-title">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="m-0 text-[13px] text-ink-2">{dateLabel}</p>
          <h2 id="workday-title" className="m-0 truncate text-xl font-medium leading-tight tracking-[-0.02em]">{greeting}</h2>
        </div>
        <div className="flex items-center gap-3">
          <p className="m-0 font-mono text-[28px] leading-none tracking-[-0.02em] tabular-nums" aria-live="off" aria-label="Активний час">{formatDuration(seconds)}</p>
          <p className="m-0 flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
            <i aria-hidden="true" className={`size-2 rounded-full ${workday?.status === 'active' ? 'bg-ok' : workday?.status === 'paused' ? 'bg-warn' : 'bg-line-strong'}`} />
            {statusText}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {workday?.status === 'active' ? <Button variant="outline" size="md" busy={busy} onClick={() => void mutate('pause')}><Pause aria-hidden="true" strokeWidth={1.5} />Пауза</Button> : null}
          {workday?.status === 'paused' ? <Button variant="action" size="md" busy={busy} onClick={() => void mutate('resume')}><Play aria-hidden="true" strokeWidth={1.5} />Продовжити</Button> : null}
          {workday && workday.status !== 'ended' && confirmCount === null ? <Button variant="ghost" size="md" busy={busy} onClick={() => void mutate('end')}><Square aria-hidden="true" strokeWidth={1.5} />Завершити</Button> : null}
          {confirmCount !== null ? (
            <>
              <Button variant="action" size="md" busy={busy} onClick={() => void mutate('end', true)}>Завершити попри {confirmCount}</Button>
              <Button variant="outline" size="md" disabled={busy} onClick={() => setConfirmCount(null)}>Не завершувати</Button>
            </>
          ) : null}
          {workday?.status === 'ended' ? <Button variant="outline" size="md" busy={busy} title="Продовжити з попереднього часу" onClick={() => void mutate('reopen')}><RotateCcw aria-hidden="true" strokeWidth={1.5} />Повернути день</Button> : null}
          <Menu>
            <MenuTrigger render={<Button variant="icon" size="md" aria-label="Ще дії робочого дня" />}><Ellipsis aria-hidden="true" strokeWidth={1.5} /></MenuTrigger>
            <MenuContent align="end" className="max-w-72">
              <MenuItem onClick={onOpenGoals}><Target aria-hidden="true" strokeWidth={1.5} />План дня: цілі й напрямки</MenuItem>
              {showPlan && workday?.plan ? <MenuLabel>Зафіксовано о {formatTime(workday.plan.createdAt)}: записи {plan.dailyGoal}, місяць {plan.monthlyGoal}, {plan.focusDirections.length ? plan.focusDirections.join(', ') : 'усі напрямки'}</MenuLabel> : null}
              {canReset ? (
                <>
                  <MenuSeparator />
                  <MenuItem onClick={() => setResetOpen(true)}><Trash2 aria-hidden="true" strokeWidth={1.5} />Скинути день</MenuItem>
                </>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {staleOpen ? <output className="block rounded-inner border border-warn/40 px-4 py-3 text-sm">Відкритий день за {formatDate(workday!.workDate)}. Заверши його перед стартом нового.</output> : null}
      {confirmCount !== null ? <output className="block rounded-inner border border-warn/40 px-4 py-3 text-sm">Залишилося справ: {confirmCount}. Завершити день попри це?</output> : null}
      {error ? <p role="alert" className="m-0 text-sm text-hot">{error}</p> : null}

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
