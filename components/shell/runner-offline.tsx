'use client';

import { useEffect, useState } from 'react';
import { Surface } from '@/components/ui/surface';
import { buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { getRunnerNotice, subscribeLiveMessages } from '@/lib/live-channel';
import { useLiveStatus } from '@/components/shell/use-live';
import { cn } from '@/lib/utils';

/**
 * Запуск runner з Work OS: посилання workos-runner://start відкриває локальний обробник, який лише будить іконку в треї
 * (параметрів із посилання він не читає). Браузер при першому разі питає дозвіл відкрити програму.
 */
export function RunnerLaunchLink({ className }: { className?: string }) {
  return (
    <a href="workos-runner://start" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}>
      Запустити runner
    </a>
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
