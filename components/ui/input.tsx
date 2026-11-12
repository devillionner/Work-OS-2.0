import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// На телефоні шрифт полів 16px: менший змушує iOS наближати сторінку при фокусі.
const FIELD = 'w-full min-w-0 border border-line bg-sunken text-sm [@media(pointer:coarse)]:text-base text-ink outline-none transition-colors duration-200 placeholder:text-ink-3 hover:border-line-strong focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45 aria-invalid:border-hot';

// Поля дати й часу в iOS Safari мають власну внутрішню ширину й виходять за край колонки: `appearance-none` і `min-w-0` вирівнюють їх по ширині, як решту полів.
const DATE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  const temporal = type !== undefined && DATE_TYPES.has(type);
  return <input data-slot="input" type={type} className={cn(FIELD, 'h-10 [@media(pointer:coarse)]:h-11 rounded-full px-4', temporal && 'block min-w-0 max-w-full appearance-none text-left [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(FIELD, 'min-h-24 resize-y rounded-inner px-4 py-3 leading-relaxed', className)} {...props} />;
}

export { FIELD as fieldClassName };
