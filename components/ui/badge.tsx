import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'hot' | 'ok' | 'warn';
const DOT: Record<Exclude<Tone, 'neutral'>, string> = { hot: 'bg-hot', ok: 'bg-ok', warn: 'bg-warn' };

/** Лічильник або сигнал стану. Не прикраса: без стану бейдж не ставимо. */
export function Badge({ tone = 'neutral', className, children, ...props }: ComponentProps<'span'> & { tone?: Tone }) {
  if (tone === 'neutral') {
    return <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-raised px-1.5 font-mono text-[11px] font-medium text-ink-2', className)} {...props}>{children}</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-ink-2', className)} {...props}>
      <i aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}
