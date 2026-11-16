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

/**
 * Рядок здоров'я: «Перевірено о 18:02 · працює», «Пауза: …» (із кнопкою «Перевірити й продовжити») або «Середовище змінилось — перевіряю».
 * Кнопка знімає паузу й просить runner спершу пройти пробну відправку, далі черга йде сама.
 */
export function HealthLine({ platform }: { platform: 'whatsapp' | 'viber' | 'telegram' }) {
  const health = useAutopostHealth(platform);
  const [asked, setAsked] = useState(false);
  if (!health?.line) return null;
  const paused = health.status === 'paused';
  const recheck = () => {
    setAsked(true);
    void fetch('/api/messenger-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'autopost-recheck', platform }) })
      .finally(() => window.setTimeout(() => setAsked(false), 4000));
  };
  return (
    <div className="flex flex-col items-start gap-2" data-health={health.status}>
      <p className={`m-0 flex items-start gap-2 text-[13px] ${paused ? 'text-warn' : 'text-ink-2'}`}>
        <i aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${paused ? 'bg-warn' : health.status === 'ok' ? 'bg-ok' : 'bg-ink-3'}`} />
        <span>{health.line}</span>
      </p>
      {paused ? <Button variant="outline" size="sm" busy={asked} onClick={recheck}>Перевірити й продовжити</Button> : null}
    </div>
  );
}

/** Той самий стан одним тихим рядком (картка «Автопост сьогодні»). */
export function HealthText({ platform }: { platform: 'whatsapp' | 'viber' | 'telegram' }) {
  const health = useAutopostHealth(platform);
  if (!health?.line) return null;
  return <p className={`m-0 text-xs ${health.status === 'paused' ? 'text-warn' : 'text-ink-3'}`}>{health.line}</p>;
}
