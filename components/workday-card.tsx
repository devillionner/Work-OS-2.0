'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Pause, Play, RotateCcw, Square, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { WorkdaySnapshot } from '@/lib/workday';

type Props = {
  initial: WorkdaySnapshot | null;
  today: string;
  unfinishedCount: number;
  dailyGoal: number;
  monthlyGoal: number;
  focusDirections: string[];
};

type WorkdayResponse = {
  workday?: WorkdaySnapshot | null;
  today?: string;
  error?: string;
  requiresConfirmation?: boolean;
  unfinishedCount?: number;
};

type WorkdaySyncResult = 'changed' | 'same' | 'skipped' | 'failed';

const SYNC_ACTIVE_MS = 5_000;
const SYNC_IDLE_MIN_MS = 15_000;
const SYNC_IDLE_MAX_MS = 60_000;
const SYNC_ERROR_MAX_MS = 300_000;
const SYNC_CHANNEL = 'work-os-workday';

export function WorkdayCard({ initial, today, unfinishedCount, dailyGoal, monthlyGoal, focusDirections }: Props) {
  const [workday, setWorkday] = useState(initial);
  const [currentToday, setCurrentToday] = useState(today);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const busyRef = useRef(false);
  const syncingRef = useRef(false);
  const syncGeneration = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const workdaySignatureRef = useRef(workdaySignature(initial, today));

  useEffect(() => {
    if (workday?.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [workday?.status]);

  const refreshWorkday = useCallback(async (): Promise<WorkdaySyncResult> => {
    if (busyRef.current || syncingRef.current) return 'skipped';
    syncingRef.current = true;
    const generation = syncGeneration.current;
    try {
      const response = await fetch('/api/workday', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return 'failed';
      const result = (await response.json()) as WorkdayResponse;
      if (generation !== syncGeneration.current || busyRef.current) return 'skipped';
      const next = result.workday ?? null;
      const nextToday = result.today || today;
      const signature = workdaySignature(next, nextToday);
      const changed = signature !== workdaySignatureRef.current;
      workdaySignatureRef.current = signature;
      setWorkday(next);
      setCurrentToday(nextToday);
      setNow(next?.asOf ?? Math.floor(Date.now() / 1000));
      return changed ? 'changed' : 'same';
    } catch {
      return 'failed';
    } finally {
      syncingRef.current = false;
    }
  }, [today]);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    let pollDelay = SYNC_ACTIVE_MS;
    let failureDelay = 0;

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const record = (result: WorkdaySyncResult) => {
      if (result === 'changed') {
        pollDelay = SYNC_ACTIVE_MS;
        failureDelay = 0;
      } else if (result === 'same') {
        pollDelay = pollDelay <= SYNC_ACTIVE_MS
          ? SYNC_IDLE_MIN_MS
          : Math.min(SYNC_IDLE_MAX_MS, pollDelay * 2);
        failureDelay = 0;
      } else if (result === 'failed') {
        failureDelay = failureDelay === 0
          ? SYNC_IDLE_MIN_MS
          : Math.min(SYNC_ERROR_MAX_MS, failureDelay * 2);
        pollDelay = failureDelay;
      } else {
        pollDelay = Math.max(SYNC_IDLE_MIN_MS, pollDelay);
      }
    };
    async function poll() {
      if (stopped) return;
      if (document.visibilityState !== 'visible' || !navigator.onLine) {
        pollDelay = SYNC_IDLE_MAX_MS;
        schedule(pollDelay);
        return;
      }
      record(await refreshWorkday());
      schedule(pollDelay);
    }
    const wake = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      schedule(0);
    };
    const onFocus = () => wake();
    const onOnline = () => wake();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = () => wake();
    }

    schedule(0);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [refreshWorkday]);

  const seconds = workday
    ? workday.activeSeconds + (workday.status === 'active' ? Math.max(0, now - workday.asOf) : 0)
    : 0;
  const staleOpen = Boolean(workday && workday.status !== 'ended' && workday.workDate !== currentToday);
  const showPlan = !workday || workday.workDate === currentToday;
  const plan = workday?.plan ?? { dailyGoal, monthlyGoal, focusDirections, createdAt: 0 };

  async function mutate(action: 'start' | 'pause' | 'resume' | 'reopen' | 'reset' | 'end', confirmIncomplete = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    syncGeneration.current += 1;
    setBusy(true);
    setError('');
    let refreshAfter = false;
    try {
      const payload: Record<string, unknown> = { action };
      if (workday && action !== 'start') {
        Object.assign(payload, {
          id: workday.id,
          workDate: workday.workDate,
          expectedVersion: workday.version,
          confirmIncomplete,
        });
      }
      const response = await fetch('/api/workday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as WorkdayResponse;
      if (!response.ok) {
        if (result.requiresConfirmation) {
          setConfirmCount(result.unfinishedCount ?? unfinishedCount);
          return;
        }
        refreshAfter = response.status === 409;
        throw new Error(result.error || 'Не вдалося оновити робочий день.');
      }
      if (action === 'reset') {
        if (result.workday !== null) throw new Error('Сервер не підтвердив скидання робочого дня.');
        syncGeneration.current += 1;
        setWorkday(null);
        setCurrentToday(result.today || today);
        workdaySignatureRef.current = workdaySignature(null, result.today || today);
        setNow(Math.floor(Date.now() / 1000));
        setConfirmCount(null);
        setResetOpen(false);
        channelRef.current?.postMessage({ type: 'workday-changed', version: null });
        return;
      }
      if (!result.workday) throw new Error('Сервер не повернув стан робочого дня.');
      syncGeneration.current += 1;
      setWorkday(result.workday);
      workdaySignatureRef.current = workdaySignature(result.workday, currentToday);
      setNow(result.workday.asOf);
      setConfirmCount(null);
      channelRef.current?.postMessage({ type: 'workday-changed', version: result.workday.version });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося оновити робочий день.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (refreshAfter) void refreshWorkday();
    }
  }

  const status = workday?.status ?? 'idle';
  const statusText = !workday
    ? 'Готово до старту'
    : workday.status === 'active'
      ? 'Триває'
      : workday.status === 'paused'
        ? 'Пауза'
        : `Завершено ${formatTime(workday.endedAt)}`;

  return (
    <section className={`workday-card workday-card--${status}`} data-workday-status={status} aria-labelledby="workday-title">
      <div className="workday-icon" aria-hidden="true">
        <Clock3 />
        {status === 'active' && <span className="workday-pulse" />}
      </div>
      <div className="workday-main">
        <div className="workday-heading">
          <div className="workday-heading-copy">
            <p className="eyebrow">Робочий день</p>
            <h2 id="workday-title">{workday ? statusLabel(workday.status) : 'Ще не розпочато'}</h2>
          </div>
          <Badge className="workday-status" variant={status === 'active' ? 'default' : 'secondary'} aria-live="polite">
            <span className={`workday-status-dot is-${status}`} aria-hidden="true" />
            {statusText}
          </Badge>
        </div>

        <div className="workday-timer-display">
          <span className="workday-timer-label">Активний час</span>
          <p className="workday-time">
            <strong>{formatDuration(seconds)}</strong>
          </p>
        </div>

        {staleOpen && (
          <div className="workday-alert is-warning">
            <AlertCircle className="workday-alert-icon" />
            <p className="muted-note">Відкритий день за {formatDate(workday!.workDate)}. Заверши його перед стартом нового.</p>
          </div>
        )}
        {confirmCount !== null && (
          <div className="workday-alert is-warning">
            <AlertCircle className="workday-alert-icon" />
            <p className="muted-note">Залишилося справ: {confirmCount}. Завершити день попри це?</p>
          </div>
        )}
        {workday?.status === 'ended' && (
          <div className="workday-alert is-neutral">
            <CheckCircle2 className="workday-alert-icon" />
            <p className="muted-note">Завершили випадково? Поверніть день, щоб продовжити з попереднього часу, або скиньте сьогоднішній день, щоб почати заново.</p>
          </div>
        )}

        {showPlan && (
          <div className="workday-plan">
            <div className="workday-plan-header">
              <strong>План дня</strong>
              <small>
                {workday?.plan
                  ? `Зафіксовано на старті о ${formatTime(workday.plan.createdAt)}`
                  : 'Цілі зафіксуються під час старту й не зміняться заднім числом.'}
              </small>
            </div>
            <div className="workday-plan-metrics">
              <span className="workday-plan-pill">
                Записи: <strong>{plan.dailyGoal}</strong>
              </span>
              <span className="workday-plan-pill">
                місячна ціль: <strong>{plan.monthlyGoal}</strong>
              </span>
            </div>
            <div className="workday-plan-focus">
              <span className="workday-plan-focus-label">Фокус:</span>
              <span className="workday-plan-focus-val">
                {plan.focusDirections.length ? plan.focusDirections.join(', ') : 'без окремого напрямку'}
              </span>
            </div>
          </div>
        )}

        {error && <p className="lead-error" role="alert">{error}</p>}
      </div>

      <div className="workday-actions">
        {!workday && (
          <Button onClick={() => mutate('start')} disabled={busy}>
            <Play data-icon="inline-start" />
            Почати день
          </Button>
        )}
        {workday?.status === 'active' && (
          <Button variant="outline" onClick={() => mutate('pause')} disabled={busy}>
            <Pause data-icon="inline-start" />
            Пауза
          </Button>
        )}
        {workday?.status === 'paused' && (
          <Button variant="default" onClick={() => mutate('resume')} disabled={busy}>
            <Play data-icon="inline-start" />
            Продовжити
          </Button>
        )}
        {workday && workday.status !== 'ended' && confirmCount === null && (
          <Button variant="outline" onClick={() => mutate('end')} disabled={busy}>
            <Square data-icon="inline-start" />
            Завершити день
          </Button>
        )}
        {confirmCount !== null && (
          <>
            <Button onClick={() => mutate('end', true)} disabled={busy}>
              Завершити попри {confirmCount}
            </Button>
            <Button variant="outline" onClick={() => setConfirmCount(null)} disabled={busy}>
              Не завершувати
            </Button>
          </>
        )}
        {workday?.status === 'ended' && (
          <Button variant="outline" onClick={() => mutate('reopen')} disabled={busy}>
            <RotateCcw data-icon="inline-start" />
            Повернути день
          </Button>
        )}
        {workday?.status === 'ended' && workday.workDate === currentToday && (
          <Button variant="destructive" onClick={() => setResetOpen(true)} disabled={busy}>
            <Trash2 data-icon="inline-start" />
            Скинути день
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Скинути робочий день?"
        description="Активний час і запис робочого дня за сьогодні буде видалено. Після цього день можна почати заново. Ліди, чати, уроки та звіти не видаляються. Цю дію не можна скасувати."
        confirmLabel="Скинути день"
        busy={busy}
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          void mutate('reset');
        }}
      />
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
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  }).format(new Date(value * 1000));
}

function workdaySignature(value: WorkdaySnapshot | null, today: string) {
  return value
    ? [
        today,
        value.id,
        value.workDate,
        value.status,
        value.version,
        value.activeSince,
        value.pausedAt,
        value.endedAt,
        value.plan?.createdAt ?? '',
      ].join(':')
    : today + ':idle';
}
