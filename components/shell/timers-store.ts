'use client';

import { useSyncExternalStore } from 'react';
import { createRefreshGate } from '@/lib/refresh-gate';
import { humanError } from '@/components/ui/human-error';

export type TimerItem = { id: string; label: string; platform: string | null; telegramAccountId: string | null; durationSeconds: number; startedAt: number; endsAt: number; status: 'running' | 'completed'; completedAt: number | null };
export type TimerPlatform = 'telegram' | 'whatsapp' | 'viber' | 'facebook' | 'general';
type TimersState = { timers: TimerItem[]; now: number; error: string; busy: boolean };

const listeners = new Set<() => void>();
const gate = createRefreshGate(15_000);
let state: TimersState = { timers: [], now: Math.floor(Date.now() / 1000), error: '', busy: false };
let clockOffset = 0;
let revision = 0;
let mutating = false;
let subscribers = 0;
let tick: number | null = null;
let teardown: (() => void) | null = null;
export const announcedTimers = new Set<string>();

function emit(next: Partial<TimersState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

async function load() {
  const expected = revision;
  const response = await fetch('/api/timers', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { timers?: TimerItem[]; serverNow?: number; error?: string };
  if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити таймери.');
  if (expected !== revision) return;
  if (body.serverNow) clockOffset = body.serverNow - Math.floor(Date.now() / 1000);
  emit({ timers: body.timers || [], error: '', now: body.serverNow ?? state.now });
}

export function syncTimers(force = false) {
  const eligible = document.visibilityState === 'visible' && navigator.onLine && !mutating;
  void gate(Date.now(), eligible, load, force).catch((reason) => emit({ error: describe(reason) }));
}

function attach() {
  const wake = () => syncTimers(true);
  const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', wake);
  // Секундний відлік локальний: до мережі він не звертається.
  tick = window.setInterval(() => emit({ now: Math.floor(Date.now() / 1000) + clockOffset }), 1000);
  const initial = window.setTimeout(wake, 0);
  teardown = () => {
    window.clearTimeout(initial);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', wake);
    if (tick !== null) window.clearInterval(tick);
    tick = null;
    revision += 1;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) attach();
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) { teardown?.(); teardown = null; }
  };
}

/** Спільний стор таймерів: Topbar і «Сьогодні» читають одні дані й роблять один запит. */
export function useTimers(): TimersState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export async function startTimer(platform: TimerPlatform, durationMinutes: number): Promise<boolean> {
  if (mutating) return false;
  mutating = true; revision += 1;
  emit({ busy: true, error: '' });
  try {
    const response = await fetch('/api/timers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', platform, durationMinutes }) });
    const body = await response.json().catch(() => ({})) as { timer?: TimerItem; error?: string };
    if (!response.ok || !body.timer) throw new Error(body.error || 'Не вдалося запустити таймер.');
    emit({ timers: [body.timer, ...state.timers] });
    return true;
  } catch (reason) {
    emit({ error: describe(reason) });
    return false;
  } finally {
    mutating = false;
    emit({ busy: false });
  }
}

export async function dismissTimer(id: string) {
  if (mutating) return;
  mutating = true; revision += 1;
  emit({ busy: true, error: '' });
  try {
    const response = await fetch('/api/timers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss', id }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok && response.status !== 409) throw new Error(body.error || 'Не вдалося закрити таймер.');
    emit({ timers: state.timers.filter((timer) => timer.id !== id) });
  } catch (reason) {
    emit({ error: describe(reason) });
  } finally {
    mutating = false;
    emit({ busy: false });
  }
}

export function describe(reason: unknown) {
  if (reason instanceof Error && (reason.name === 'TimeoutError' || reason.name === 'AbortError')) return 'Сервер не відповідає. Таймери синхронізуються автоматично, щойно зв’язок відновиться.';
  if (reason instanceof Error && /failed to fetch|networkerror|load failed/i.test(reason.message)) return 'Немає зв’язку із сервером. Таймери синхронізуються після відновлення мережі.';
  return humanError(reason, 'Сталася помилка.');
}

export function formatTimerDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function splitTimers(timers: TimerItem[], now: number) {
  return {
    running: timers.filter((timer) => timer.status === 'running' && timer.endsAt > now),
    completed: timers.filter((timer) => timer.status === 'completed' || timer.endsAt <= now),
  };
}
