'use client';

import { emitCommand } from '@/components/shell/command-bus';
import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { getLatestPace } from '@/lib/live-channel';
import { cn } from '@/lib/utils';
import { clockOf } from '@/components/views/today/day-model';
import { useMinuteClock } from '@/components/views/today/use-minute-clock';
import { useAutopostDay, type AutopostDayPlatform } from '@/components/views/today/use-autopost-day';

const NAMES = { whatsapp: 'WhatsApp', viber: 'Viber', telegram: 'Telegram' } as const;
const ORDER: ReadonlyArray<AutopostDayPlatform['platform']> = ['viber', 'whatsapp', 'telegram'];
const REASONS: ReadonlyArray<{ key: keyof AutopostDayPlatform['settled']; label: string }> = [
  { key: 'decision', label: 'Потребують рішення' },
  { key: 'archived', label: 'В архів: бан, заборона писати, чату немає' },
  { key: 'snoozed', label: 'Відкладено на завтра' },
  { key: 'waiting', label: 'Очікують вступу' },
  { key: 'skipped', label: 'Пропущено на сьогодні' },
  { key: 'thread', label: 'Чекають вибору гілки' },
];

const DOT = { run: 'bg-ink', done: 'bg-ok', wait: 'bg-warn' } as const;

/**
 * «Автопост сьогодні»: по кожній платформі відправлено, не пішло й лишилось із часом партії, нижче «не пішло» за причиною й одна кнопка
 * до «Потребують рішення». Числа лічильників дня, які вже читає «Платформи»; оновлюється подіями live-каналу, без таймера.
 */
export function AutopostDayCard({ size }: { size: 'phone' | 'desktop' }) {
  const { day } = useAutopostDay();
  const nowSeconds = useMinuteClock();
  const { navigate } = useShell();
  const platforms = ORDER.map((key) => day?.platforms.find((item) => item.platform === key)).filter((item): item is AutopostDayPlatform => Boolean(item));
  const active = platforms.filter((item) => item.total > 0 || item.settled.thread > 0);
  const open = (platform?: AutopostDayPlatform['platform']) => {
    navigate('platforms');
    emitCommand('platforms:autopost', { platform: platform ?? 'viber' });
  };
  // Заархівовані (бан, заборона писати, чат не існує) відкриваються в черзі «Архів» платформи: там у кожному рядку причина й посилання на чат.
  const openArchive = (platform?: AutopostDayPlatform['platform']) => {
    navigate('platforms');
    emitCommand('platforms:queue', { platform: platform ?? 'telegram', queue: 'archived' });
  };
  const pad = size === 'phone' ? 'p-4' : 'p-5';
  if (!day) return null;

  if (!active.length) {
    return (
      <Surface variant="glass" radius="card" data-reveal className={cn('flex min-w-0 flex-col items-start gap-3', pad)} aria-label="Автопост сьогодні">
        <div><h3 className="m-0 text-[15px] font-medium">Автопост сьогодні</h3><p className="m-0 mt-0.5 text-[13px] text-ink-2">Партії ще не запускали</p></div>
        <Button variant="outline" size="sm" onClick={() => open()}>Відкрити автопост</Button>
      </Surface>
    );
  }

  const sent = active.reduce((sum, item) => sum + item.sent, 0);
  const failed = active.reduce((sum, item) => sum + item.failed, 0);
  const left = active.reduce((sum, item) => sum + item.pending + item.claimed, 0);
  const decision = active.reduce((sum, item) => sum + item.settled.decision, 0);
  const reasons = REASONS.map((reason) => {
    const per = active.filter((item) => item.settled[reason.key] > 0);
    return { ...reason, total: per.reduce((sum, item) => sum + item.settled[reason.key], 0), per };
  }).filter((reason) => reason.total > 0);

  return (
    <Surface variant="glass" radius="card" data-reveal className={cn('flex min-w-0 flex-col gap-5', pad)} aria-label="Автопост сьогодні">
      <div><h3 className="m-0 text-[15px] font-medium">Автопост сьогодні</h3><p className="m-0 mt-0.5 text-[13px] text-ink-2">Партії всіх платформ за сьогодні</p></div>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2"><b className="text-[30px] font-medium leading-none tracking-tight text-ink">{sent}</b>відправлено{failed ? ` · ${failed} не пішло` : ''}{left ? ` · ${left} лишилось` : ''}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {active.map((item) => {
          const total = Math.max(1, item.total);
          const pace = getLatestPace(item.platform);
          const state = item.running ? (item.claimed > 0 || !pace || pace.nextAt <= nowSeconds * 1000 ? 'run' : 'wait') : 'done';
          const label = state === 'done' ? 'Завершено' : state === 'wait' ? `Чекає інтервалу · наступна о ${clockOf(Math.floor((pace?.nextAt ?? nowSeconds * 1000) / 1000))}` : 'Іде';
          return (
            <li key={item.platform} className="flex flex-col gap-2 rounded-inner border border-line bg-sunken p-3.5">
              <div className="flex items-baseline justify-between gap-3"><span className="text-sm font-medium">{NAMES[item.platform]}</span><span className="font-mono text-sm">{item.sent} <small className="text-xs text-ink-3">з {item.total}</small></span></div>
              <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <i className="block h-full bg-ink" style={{ width: `${(item.sent / total) * 100}%` }} />
                <i className="block h-full bg-hot" style={{ width: `${(item.failed / total) * 100}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-3">
                <span className="inline-flex items-center gap-1.5 text-ink-2"><i aria-hidden="true" className={cn('size-[7px] rounded-full', DOT[state])} />{label}</span>
                <span className="font-mono">{item.startedAt ? `${clockOf(item.startedAt)}${state === 'done' && item.lastAt ? ` – ${clockOf(item.lastAt)}` : ''}` : ''}{left && item.pending + item.claimed ? ` · лишилось ${item.pending + item.claimed}` : ''}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {reasons.length ? (
        <div>
          <h4 className="m-0 mb-1 text-[13px] font-medium text-ink-2">Не пішло · {failed}</h4>
          <ul className="m-0 flex list-none flex-col p-0">
            {reasons.map((reason) => (
              <li key={reason.key} className="border-t border-line first:border-t-0">
                <button type="button" onClick={() => (reason.key === 'archived' ? openArchive(reason.per[0]?.platform) : open(reason.per[0]?.platform))} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-left outline-offset-2 transition-colors hover:bg-raised">
                  <span className="flex min-w-0 flex-col"><span className="text-sm">{reason.label}</span><span className="text-xs text-ink-3">{reason.per.map((item) => `${NAMES[item.platform]} ${item.settled[reason.key]}`).join(' · ')}</span></span>
                  <span className="font-mono text-sm font-medium">{reason.total}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button variant={decision ? 'action' : 'outline'} size="md" onClick={() => open(active.find((item) => item.settled.decision > 0)?.platform)}>{decision ? `Потребують рішення · ${decision}` : 'Відкрити автопост'}</Button>
    </Surface>
  );
}
