import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const FIELD = 'w-full min-w-0 border border-line bg-sunken text-sm text-ink outline-none transition-colors duration-200 placeholder:text-ink-3 hover:border-line-strong focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45 aria-invalid:border-hot';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(FIELD, 'h-10 rounded-full px-4', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(FIELD, 'min-h-24 resize-y rounded-inner px-4 py-3 leading-relaxed', className)} {...props} />;
}

export { FIELD as fieldClassName };
