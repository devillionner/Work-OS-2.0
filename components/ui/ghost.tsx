import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** «Привид» майбутнього контенту: точна форма задається класами розміру й радіуса. */
export function Ghost({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('ghost rounded-inner', className)} {...props} />;
}
