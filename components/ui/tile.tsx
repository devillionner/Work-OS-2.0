'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/motion/count-up';
import type { RingTone } from '@/components/ui/ring';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

export type TileDelta = { text: string; tone?: 'neutral' | 'ok' | 'hot' };

/** KPI-плитка: підпис і велике число ліворуч, утоплена права половина з монохромним гліфом. */
export function Tile({ label, value, format, hint, icon: Icon, progress, delta, aside, onClick, className }: {
  label: string;
  value: number;
  format?: (value: number) => string;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Прогрес до цілі, 0–1+. Тонка смужка під числом. */
  progress?: { value: number; tone?: RingTone };
  delta?: TileDelta;
  /** Власний вміст утопленої половини замість гліфа. */
  aside?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-4 p-4 @[16rem]/tile:p-5">
        <span className="text-[13px] text-ink-2">{label}</span>
        {Icon ? <Icon aria-hidden="true" strokeWidth={1.25} className="absolute right-4 top-4 size-5 text-ink-3 @[16rem]/tile:hidden" /> : null}
        <div className="flex flex-col gap-2">
          <CountUp value={value} format={format} className="text-[40px] font-normal leading-none tracking-[-0.03em]" />
          <div className="flex min-h-4 items-center gap-2 text-xs text-ink-2">
            {delta ? (
              <span className={cn(delta.tone === 'ok' && 'text-ok', delta.tone === 'hot' && 'text-hot')}>{delta.text}</span>
            ) : null}
            {hint ? <span className="truncate">{hint}</span> : null}
          </div>
          {progress ? (
            <>
              <progress className="sr-only" aria-label={label} max={100} value={Math.round(Math.min(1, progress.value) * 100)} />
              <div aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-line">
                <div className="h-full origin-left rounded-full" style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress.value))})`, background: progress.tone === 'ok' ? 'var(--signal-ok)' : progress.tone === 'warn' ? 'var(--signal-warn)' : progress.tone === 'hot' ? 'var(--signal-hot)' : 'var(--ink)', transition: 'transform 0.6s var(--ease-out)' }} />
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="m-2 ml-0 hidden w-[38%] min-w-[84px] items-center justify-center rounded-inner bg-sunken text-ink-3 @[16rem]/tile:flex">
        {aside ?? (Icon ? <Icon aria-hidden="true" strokeWidth={1.25} className="size-9" /> : null)}
      </div>
    </>
  );
  const shared = cn('@container/tile flex min-h-[132px] w-full text-left @[16rem]/tile:min-h-[148px]', className);
  return onClick ? (
    <Surface as="button" type="button" lift spot data-reveal onClick={onClick} className={shared}>{body}</Surface>
  ) : (
    <Surface spot data-reveal className={shared}>{body}</Surface>
  );
}
