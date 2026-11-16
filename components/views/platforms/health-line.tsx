'use client';

import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { getLatestHealth, subscribeLiveMessages, type AutopostHealth } from '@/lib/live-channel';

const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  subscribeLiveMessages((message) => {
    if (message.type === 'hello' || (message.type === 'progress' && message.process === 'autopost_health')) for (const listener of listeners) listener();
  });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Здоров'я автопосту платформи від runner (пробна відправка й запобіжник серії): приходить подіями live-каналу, без запитів до бази. */
export function useAutopostHealth(platform: 'whatsapp' | 'viber' | 'telegram'): AutopostHealth | null {
  return useSyncExternalStore(subscribe, () => getLatestHealth(platform), () => null);
}

/** «Перевірити й продовжити»: знімає паузу й просить runner спершу пройти пробну відправку, далі черга йде сама. */
export function RecheckButton({ platform }: { platform: 'whatsapp' | 'viber' | 'telegram' }) {
  const [asked, setAsked] = useState(false);
  const recheck = () => {
    setAsked(true);
    void fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'autopost-recheck', platform }) })
      .finally(() => window.setTimeout(() => setAsked(false), 4000));
  };
  return <Button variant="outline" size="sm" busy={asked} onClick={recheck} className="self-start">Перевірити й продовжити</Button>;
}

/** Той самий стан одним тихим рядком (картка «Автопост сьогодні»). */
export function HealthText({ platform }: { platform: 'whatsapp' | 'viber' | 'telegram' }) {
  const health = useAutopostHealth(platform);
  if (!health?.line) return null;
  return <p className={`m-0 text-xs ${health.status === 'paused' ? 'text-warn' : 'text-ink-3'}`}>{health.line}</p>;
}
