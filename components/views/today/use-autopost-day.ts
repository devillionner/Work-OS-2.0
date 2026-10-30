'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewActive } from '@/components/shell/view-pane';
import { subscribeLiveMessages } from '@/lib/live-channel';

export type AutopostDayPlatform = {
  platform: 'whatsapp' | 'viber' | 'telegram';
  total: number; sent: number; failed: number; pending: number; claimed: number; running: boolean;
  settled: { archived: number; waiting: number; snoozed: number; skipped: number; decision: number; thread: number };
  startedAt: number | null; lastAt: number | null;
};
export type AutopostDay = { date: string; platforms: AutopostDayPlatform[] };

const REFRESH_DELAY_MS = 8_000;

/**
 * Підсумок дня автопосту для «Сьогодні»: один запит при відкритті розділу, далі лише за подіями live-каналу (результат чи початок задачі автопосту)
 * з затримкою, поки розділ видно. Таймера немає.
 */
export function useAutopostDay(): { day: AutopostDay | null; loading: boolean } {
  const active = useViewActive();
  const [day, setDay] = useState<AutopostDay | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/messenger-automation?summary=1', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json() as { summary?: AutopostDay };
      if (body.summary) setDay(body.summary);
    } catch { /* без мережі картка лишається з попередніми числами */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = window.setTimeout(() => void load(), 0);
    const schedule = () => {
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => { timer.current = null; void load(); }, REFRESH_DELAY_MS);
    };
    const off = subscribeLiveMessages((message) => {
      if ((message.type === 'process_state' && message.process === 'autopost') || (message.type === 'result' && message.process === 'autopost')) schedule();
    });
    return () => { window.clearTimeout(first); off(); if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  }, [active, load]);

  return { day, loading };
}
