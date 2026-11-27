'use client';

import { emitCommand } from '@/components/shell/command-bus';
import { useAutopostDay, type AutopostDayPlatform } from '@/components/views/today/use-autopost-day';
import { cn } from '@/lib/utils';

const NAMES = { whatsapp: 'WhatsApp', viber: 'Viber', telegram: 'Telegram' } as const;
const ORDER: ReadonlyArray<AutopostDayPlatform['platform']> = ['viber', 'whatsapp', 'telegram'];

/**
 * Тихий рядок над зонами «Платформ»: стан автопосту всіх платформ за сьогодні («Viber 26/79 · Telegram 3/20 · рішення 4»).
 * Ті самі лічильники дня, що в «Автопост сьогодні» (`?summary=1`, перечитуються лише за подіями live-каналу, без таймера).
 * Тап по платформі відкриває її автопост, по «рішення» — список «Потребують рішення» платформи, де їх найбільше.
 */
export function AutopostStrip({ enabled, current }: { enabled: readonly string[]; current: string }) {
  const { day } = useAutopostDay();
  const platforms = ORDER.flatMap((key) => {
    const entry = day?.platforms.find((item) => item.platform === key);
    return entry && entry.total > 0 && enabled.includes(key) ? [entry] : [];
  });
  if (!platforms.length) return null;
  const decisions = platforms.reduce((sum, item) => sum + item.settled.decision, 0);
  const mostDecisions = platforms.reduce((best, item) => (item.settled.decision > best.settled.decision ? item : best), platforms[0]);
  const item = 'inline-flex min-h-8 items-center gap-1 rounded-full px-1 hover:text-ink [@media(pointer:coarse)]:min-h-9';
  return (
    <nav aria-label="Автопост сьогодні на всіх платформах" className="-mx-1 flex min-w-0 flex-wrap items-center gap-x-0.5 text-xs text-ink-2">
      {platforms.map((entry, index) => (
        <span key={entry.platform} className="inline-flex items-center">
          {index ? <span aria-hidden="true" className="text-ink-3">·</span> : null}
          <button type="button" className={cn(item, entry.platform === current && 'text-ink')} title={`Автопост ${NAMES[entry.platform]}: відправлено ${entry.sent} з ${entry.total} за сьогодні`} onClick={() => emitCommand('platforms:autopost', { platform: entry.platform })}>
            {entry.running ? <i aria-hidden="true" className="size-1.5 rounded-full bg-ink" /> : null}
            {NAMES[entry.platform]} <span className="tabular-nums">{entry.sent}/{entry.total}</span>
          </button>
        </span>
      ))}
      {decisions > 0 ? (
        <span className="inline-flex items-center">
          <span aria-hidden="true" className="text-ink-3">·</span>
          <button type="button" className={cn(item, 'text-hot')} title="Відкрити «Потребують рішення»" onClick={() => emitCommand('platforms:autopost', { platform: mostDecisions.platform, section: 'decisions' })}>
            рішення <span className="tabular-nums">{decisions}</span>
          </button>
        </span>
      ) : null}
    </nav>
  );
}
