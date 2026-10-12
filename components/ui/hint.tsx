'use client';

import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Підказка «?»: пояснення (як рахуємо, що означає) ховається за маленькою кнопкою й відкривається за запитом, а не займає місце на екрані. */
export function Hint({ children, label = 'Пояснення' }: { children: ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" aria-label={label} className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink [@media(pointer:coarse)]:size-9" />}>
        <CircleHelp aria-hidden="true" strokeWidth={1.5} className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" label={label}>
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">{children}</p>
      </PopoverContent>
    </Popover>
  );
}
