import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-sunken px-1.5 font-mono text-[11px] font-medium text-ink-2', className)} {...props} />;
}
