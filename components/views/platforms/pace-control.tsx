'use client';

import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import type { WhatsAppAutopostProgress } from '@/components/views/platforms/autopost-card';
import type { AutopostPace, AutopostPlatformStatus } from '@/lib/live-channel';

/** Відправок на годину; 0 — без пауз (лише Viber і WhatsApp: у Telegram найвищий темп 30 на годину). */
export type PerHour = 0 | 5 | 10 | 20 | 30;
export type PacePlatform = 'viber' | 'whatsapp' | 'telegram';

const VALUES: Record<PacePlatform, PerHour[]> = { viber: [5, 10, 20, 30, 0], whatsapp: [5, 10, 20, 30, 0], telegram: [5, 10, 20, 30] };
const DEFAULT: Record<PacePlatform, PerHour> = { viber: 0, whatsapp: 0, telegram: 10 };
/** Скільки триває один чат без пауз (за вимірами партій): Viber ≈ 30 с разом із проміжком між чатами, WhatsApp ≈ 40 с, Telegram ≈ 15 с. */
const SECONDS_NO_PAUSE: Record<PacePlatform, number> = { viber: 30, whatsapp: 40, telegram: 15 };
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
  return perHour > 0 ? Math.max(Math.round(3600 / perHour), SECONDS_NO_PAUSE[platform]) : SECONDS_NO_PAUSE[platform];
}

export function durationText(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours ? `${hours} год` : ''}${hours && minutes ? ' ' : ''}${minutes || !hours ? `${minutes} хв` : ''}`;
}

const chatsWord = (count: number) => (count % 10 === 1 && count % 100 !== 11 ? 'чат' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'чати' : 'чатів');

/** «Оцінка: 63 чати ≈ 3 год 9 хв при 20 на годину» або «80 чатів ≈ 40 хв без пауз»: довге очікування не виглядає як зависання. */
export function PaceEstimate({ platform, count, perHour, running }: { platform: PacePlatform; count: number; perHour: PerHour; running: boolean }) {
  if (running || count <= 0) return null;
  const minutes = Math.max(1, Math.round((count * secondsPerChat(platform, perHour)) / 60));
  return <p className="m-0 text-sm text-ink-2">Оцінка: <span className="tabular-nums">{count}</span> {chatsWord(count)} ≈ {durationText(minutes)} {perHour > 0 ? `при ${perHour} на годину` : 'без пауз'}</p>;
}

/** Сегмент «5 · 10 · 20 · 30 на годину · Без пауз» (у Telegram без «Без пауз»). */
export function PaceSegment({ platform, value, onChange }: { platform: PacePlatform; value: PerHour; onChange: (value: PerHour) => void }) {
  const items = VALUES[platform].map((item) => ({ value: String(item), label: item === 0 ? 'Без пауз' : `${item} на годину` }));
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span className="text-sm text-ink-2">Темп</span>
      <Segmented<string> label="Скільки відправок на годину" size="sm" value={String(value)} onValueChange={(next) => onChange(Number(next) as PerHour)} items={items} />
    </div>
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
  if (!running || !progress) return null;
  const left = progress.pending + progress.claimed;
  const paused = status?.state === 'blocked' && status.until !== null && (now === 0 || status.until > now);
  const intervalMs = (pace?.intervalSeconds ?? 0) * 1000;
  const next = pace && pace.nextAt > 0 ? Math.max(pace.nextAt, status?.until ?? 0) : null;
  const nextText = next === null ? 'зараз' : now > 0 && next <= now ? 'зараз' : `о ${clock(next)}`;
  const end = next !== null && intervalMs > 0 && left > 0 ? Math.max(next, now) + (left - 1) * intervalMs : null;
  return (
    <p className="m-0 text-sm text-ink-2" aria-live="polite">
      {paused ? <>Черга на паузі до {clock(status?.until ?? 0)}. </> : null}
      Наступна {noun} {nextText} · залишилось <b className="font-mono font-normal tabular-nums text-ink">{left}</b>{end ? <> · орієнтовно до {clock(end)}</> : null}
    </p>
  );
}
