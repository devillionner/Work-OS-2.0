'use client';

import { useEffect, useState } from 'react';
import { Surface } from '@/components/ui/surface';
import { Button, buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { getRunnerNotice, subscribeLiveMessages } from '@/lib/live-channel';
import { useLiveStatus } from '@/components/shell/use-live';
import { cn } from '@/lib/utils';

type LaunchState = 'idle' | 'sending' | 'sent' | 'slow' | 'offline';

/** Телефон чи планшет: локального обробника workos-runner:// там немає (Safari: «адреса недійсна»). */
function isMobileDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const LAUNCH_TEXT: Partial<Record<LaunchState, string>> = {
  sent: 'Команду надіслано на ПК, runner запускається (до хвилини).',
  slow: 'ПК отримав команду, але runner ще не підключився. Подивись, що з ним на ПК.',
  offline: 'ПК не на зв\'язку: він вимкнений чи спить, або там ще стара версія runner. Один раз запусти runner на самому ПК, далі кнопка працюватиме й з телефону.',
};

/**
 * «Запустити runner» з будь-якого пристрою: команда через Work OS черговому на ПК (`runner-standby.mjs`, працює й після
 * «Вимкнути повністю»). Коли черговий не відповів, на самому ПК лишається посилання workos-runner://start (локальний обробник,
 * який лише будить іконку в треї; браузер при першому разі питає дозвіл відкрити програму).
 */
export function RunnerLaunchLink({ className }: { className?: string }) {
  const live = useLiveStatus();
  const [state, setState] = useState<LaunchState>('idle');
  const connected = live.runnerConnected === true;

  useEffect(() => {
    if (state !== 'sent') return;
    const timer = window.setTimeout(() => setState('slow'), 90_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function launch() {
    setState('sending');
    try {
      const response = await fetch('/api/runner/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({})) as { delivered?: number };
      if (response.ok && Number(result.delivered) > 0) { setState('sent'); return; }
    } catch { /* мережа: нижче запасний шлях */ }
    if (!isMobileDevice()) { setState('idle'); window.location.href = 'workos-runner://start'; return; }
    setState('offline');
  }

  const text = connected ? '' : LAUNCH_TEXT[state];
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-2', className)}>
      <Button variant="outline" size="sm" busy={state === 'sending'} onClick={() => { void launch(); }}>
        {state === 'sent' ? 'Запускаю…' : 'Запустити runner'}
      </Button>
      {text ? <p aria-live="polite" className={cn('m-0 text-sm', state === 'offline' || state === 'slow' ? 'text-warn' : 'text-ink-2')}>{text}</p> : null}
    </div>
  );
}

/** Картка для «Сьогодні»: видна лише коли канал живий, а runner на ПК не підключений. */
export function RunnerOfflineCard() {
  const live = useLiveStatus();
  if (!live.connected || live.runnerConnected !== false) return null;
  return (
    <Surface variant="glass" radius="card" className="flex min-w-0 flex-col items-start gap-3 p-4" aria-label="Runner вимкнений">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[15px] font-medium">Runner вимкнений</p>
        <p className="m-0 text-sm text-ink-2">Автопост, перевірки чатів і сповіщення з ПК не працюють, поки він не запущений.</p>
      </div>
      <RunnerLaunchLink />
    </Surface>
  );
}

/** «Runner оновлено до 3.x.y»: runner сам перезапускається після зміни коду й повідомляє про це один раз. */
export function RunnerNotice() {
  const toast = useToast();
  useEffect(() => subscribeLiveMessages((message) => {
    if (message.type === 'runner_status' && message.updated === true && typeof message.version === 'string' && message.version) {
      toast.push({ message: `Runner оновлено до ${message.version}`, tone: 'ok' });
    }
  }), [toast]);
  return null;
}

/** Несрочне повідомлення runner за кодом (живе, поки runner його підтримує). */
export function useRunnerNotice(code: string): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setText(getRunnerNotice(code));
    const first = window.setTimeout(read, 0);
    const off = subscribeLiveMessages((message) => { if (message.type === 'hello' || message.type === 'runner_status' || (message.type === 'progress' && message.process === 'runner_notice')) read(); });
    return () => { window.clearTimeout(first); off(); };
  }, [code]);
  return text;
}

/** Посилання «Відкрити вікно» Android: обробник workos-waydroid://show відкриває вікно лише за дією власника. */
export function WaydroidWindowLink({ className }: { className?: string }) {
  return (
    <a href="workos-waydroid://show" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}>
      Відкрити вікно
    </a>
  );
}
