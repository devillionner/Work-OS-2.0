'use client';

import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import { useLiveSynced } from '@/components/views/platforms/use-live-synced';
import type { AutopostPace, AutopostPlatformStatus } from '@/lib/live-channel';
import { secondsPerChat as sharedSecondsPerChat } from '@/lib/autopost-estimate.mjs';

/** Відправок на годину; 0 — без пауз (лише Viber і WhatsApp: у Telegram найвищий темп 30 на годину). */
export type PerHour = 0 | 5 | 10 | 20 | 30;
export type PacePlatform = 'viber' | 'whatsapp' | 'telegram';

const VALUES: Record<PacePlatform, PerHour[]> = { viber: [5, 10, 20, 30, 0], whatsapp: [5, 10, 20, 30, 0], telegram: [5, 10, 20, 30] };
const DEFAULT: Record<PacePlatform, PerHour> = { viber: 0, whatsapp: 0, telegram: 10 };
const key = (platform: PacePlatform) => `work-os:autopost-per-hour:${platform}`;

function readPerHour(platform: PacePlatform): PerHour {
  try {
    const raw = window.localStorage.getItem(key(platform));
    if (raw === null) return DEFAULT[platform];
    const value = Number(raw) as PerHour;
    return VALUES[platform].includes(value) ? value : DEFAULT[platform];
  } catch { return DEFAULT[platform]; }
}

/** Темп платформи: зберігається в браузері окремо для кожної платформи. */
export function usePerHour(platform: PacePlatform): [PerHour, (value: PerHour) => void] {
  const [value, setValue] = useState<PerHour>(() => readPerHour(platform));
  const update = (next: PerHour) => {
    setValue(next);
    try { window.localStorage.setItem(key(platform), String(next)); } catch { /* вибір діє до перезавантаження */ }
  };
  return [value, update];
}

/** Скільки секунд на чат: за темпом (3600 / N), а без пауз — за вимірами платформи; повільніше з двох. */
export function secondsPerChat(platform: PacePlatform, perHour: PerHour): number {
  return sharedSecondsPerChat(platform, [], perHour);
}

/**
 * Сегмент «Темп, на годину: 5 · 10 · 20 · 30 · Без пауз» (у Telegram без «Без пауз»). Одиниця винесена в підпис, а в пунктах лише числа:
 * так перемикач влізає в картку на телефоні (390 px) без прокрутки й обрізаних пунктів.
 */
export function PaceSegment({ platform, value, onChange }: { platform: PacePlatform; value: PerHour; onChange: (value: PerHour) => void }) {
  const items = VALUES[platform].map((item) => ({ value: String(item), label: item === 0 ? 'Без пауз' : <span className="tabular-nums">{item}</span> }));
  // Два елементи сітки групи запуску (підпис | перемикач), під «Чатів у партії».
  return (
    <>
      <span className="mt-2 text-[13px] text-ink-2 sm:mt-0">Темп, на годину</span>
      <Segmented<string> label="Скільки відправок на годину" size="sm" value={String(value)} onValueChange={(next) => onChange(Number(next) as PerHour)} items={items} />
    </>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

/** Секундний годинник лише поки партія йде; 0 — ще не стартував (час під час рендеру не читаємо). */
function useClock(enabled: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 15_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [enabled]);
  return enabled ? now : 0;
}

/** «Наступна публікація о 14:36 · залишилось 12 · орієнтовно до 16:00»: час з DO, число з лічильників партії, кінець — за інтервалом. */
export function PaceLine({ pace, progress, running, status, noun }: { pace: AutopostPace | null; progress: WhatsAppAutopostProgress | null; running: boolean; status: AutopostPlatformStatus | null; noun: string }) {
  const now = useClock(running);
  const synced = useLiveSynced();
  if (!running || !progress) return null;
  const left = progress.pending + progress.claimed;
  const paused = status?.state === 'blocked' && status.until !== null && (now === 0 || status.until > now);
  const intervalMs = (pace?.intervalSeconds ?? 0) * 1000;
  const next = pace && pace.nextAt > 0 ? Math.max(pace.nextAt, status?.until ?? 0) : null;
  // Час зі знімка DO вважаємо дійсним, лише коли канал синхронізований: після сну вкладки він міг застаріти.
  const nextText = !synced ? 'оновлюю…' : next === null ? 'зараз' : now > 0 && next <= now ? 'зараз' : `о ${clock(next)}`;
  const end = next !== null && intervalMs > 0 && left > 0 ? Math.max(next, now) + (left - 1) * intervalMs : null;
  // Кільце партії вже показує «Лишилось» і «До кінця», а «Зараз» між відправками — «наступна о …»: тут лишається лише час наступної, поки чат у роботі (і пауза).
  const ring = progress.batch && progress.batch.total > 0 ? progress.batch : null;
  if (ring) {
    if (!paused && (ring.inProgress === 0 || next === null || intervalMs === 0)) return null;
    return (
      <p className="m-0 text-sm text-ink-2" aria-live="polite">
        {paused ? <>Черга на паузі до {clock(status?.until ?? 0)}. </> : null}
        Наступна {noun} {nextText}
      </p>
    );
  }
  return (
    <p className="m-0 text-sm text-ink-2" aria-live="polite">
      {paused ? <>Черга на паузі до {clock(status?.until ?? 0)}. </> : null}
      Наступна {noun} {nextText} · залишилось <span className="tabular-nums text-ink">{left}</span>{end ? <> · орієнтовно до {clock(end)}</> : null}
    </p>
  );
}
