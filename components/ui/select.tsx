import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { fieldClassName } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Нативний select у стилі системи: доступність і мобільний вибір безкоштовно. */
export function Select({ className, wrapperClassName, children, ...props }: ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <span className={cn('relative inline-flex w-full min-w-0 items-center', wrapperClassName)}>
      <select data-slot="select" className={cn(fieldClassName, 'h-10 appearance-none rounded-full pl-4 pr-10', className)} {...props}>{children}</select>
      <ChevronDown aria-hidden="true" strokeWidth={1.5} className="pointer-events-none absolute right-3.5 size-4 text-ink-2" />
    </span>
  );
}
