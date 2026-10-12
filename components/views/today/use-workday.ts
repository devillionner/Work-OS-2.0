'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '@/components/shell/shell-context';
import { humanError } from '@/components/ui/human-error';
import type { WorkdaySnapshot } from '@/lib/workday';

type WorkdayResponse = { workday?: WorkdaySnapshot | null; today?: string; error?: string; requiresConfirmation?: boolean; unfinishedCount?: number };
export type WorkdayAction = 'start' | 'pause' | 'resume' | 'reopen' | 'reset' | 'end';
const SYNC_CHANNEL = 'work-os-workday';

function signatureOf(value: WorkdaySnapshot | null, today: string) {
  return value ? [today, value.id, value.workDate, value.status, value.version, value.activeSince, value.pausedAt, value.endedAt, value.plan?.createdAt ?? ''].join(':') : `${today}:idle`;
}

/**
 * Стан робочого дня: Почати, Пауза, Продовжити, Завершити (з підтвердженням незавершених), Повернути, Скинути. Дані приходять
 * зі знімка «Сьогодні»; додатково перечитуються лише коли застосунок знову стає видимим, відновлюється мережа або інша вкладка
 * повідомляє про зміну. Жодного опитування за таймером.
 */
export function useWorkday() {
  const { snapshot } = useShell();
  const [workday, setWorkday] = useState<WorkdaySnapshot | null>(snapshot.workday);
  const [currentToday, setCurrentToday] = useState(snapshot.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const busyRef = useRef(false);
  const syncingRef = useRef(false);
  const generation = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signature = useRef(signatureOf(snapshot.workday, snapshot.today));

  // Новий знімок «Сьогодні» (live-канал, повернення у вкладку) — єдине джерело правди, коли відрізняється.
  useEffect(() => {
    const next = signatureOf(snapshot.workday, snapshot.today);
    if (next === signature.current || busyRef.current) return;
    signature.current = next;
    queueMicrotask(() => {
      setWorkday(snapshot.workday);
      setCurrentToday(snapshot.today);
    });
  }, [snapshot.workday, snapshot.today]);

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
      signature.current = signatureOf(next, nextToday);
      setWorkday(next);
      setCurrentToday(nextToday);
    } catch { /* наступне повернення у вкладку повторить спробу */ } finally {
      syncingRef.current = false;
    }
  }, [snapshot.today]);

  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = wake;
    }
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [refresh]);

  async function mutate(action: WorkdayAction, confirmIncomplete = false): Promise<boolean> {
    if (busyRef.current) return false;
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
        if (result.requiresConfirmation) { setConfirmCount(result.unfinishedCount ?? snapshot.leadTaskCount); return false; }
        refreshAfter = response.status === 409;
        throw new Error(result.error || 'Не вдалося оновити робочий день.');
      }
      if (action === 'reset') {
        if (result.workday !== null) throw new Error('Сервер не підтвердив скидання робочого дня.');
        generation.current += 1;
        setWorkday(null);
        setCurrentToday(result.today || snapshot.today);
        signature.current = signatureOf(null, result.today || snapshot.today);
        setConfirmCount(null);
        channelRef.current?.postMessage({ type: 'workday-changed', version: null });
        return true;
      }
      if (!result.workday) throw new Error('Сервер не повернув стан робочого дня.');
      generation.current += 1;
      setWorkday(result.workday);
      signature.current = signatureOf(result.workday, currentToday);
      setConfirmCount(null);
      channelRef.current?.postMessage({ type: 'workday-changed', version: result.workday.version });
      return true;
    } catch (reason) {
      setError(humanError(reason, 'Не вдалося оновити робочий день.'));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (refreshAfter) void refresh();
    }
  }

  return { workday, currentToday, busy, error, confirmCount, setConfirmCount, mutate };
}

export type WorkdayState = ReturnType<typeof useWorkday>;
