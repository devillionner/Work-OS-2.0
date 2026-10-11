import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Фільтр-чіп з aria-pressed і необов'язковим лічильником. */
export function Chip({ pressed = false, count, className, children, ...props }: Omit<ComponentProps<'button'>, 'children'> & { pressed?: boolean; count?: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 active:scale-[0.985] disabled:opacity-45',
        pressed ? 'border-transparent bg-action text-action-ink' : 'border-line text-ink-2 hover:bg-raised hover:text-ink',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="font-mono text-[11px] opacity-70">{count}</span> : null}
    </button>
  );
}
