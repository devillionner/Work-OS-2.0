'use client';

import type { ReactNode } from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string> = { value: T; label: ReactNode; count?: ReactNode };

/** Сегментований pill-перемикач на base-ui Tabs (клавіатура й aria — з коробки). Контент рендерить споживач. */
export function Segmented<T extends string>({ value, onValueChange, items, label, size = 'md', className }: {
  value: T;
  onValueChange: (value: T) => void;
  items: ReadonlyArray<SegmentedItem<T>>;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(next) => onValueChange(next as T)}>
      <TabsPrimitive.List
        aria-label={label}
        className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-sunken p-1 hide-scrollbar', className)}
      >
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full font-medium text-ink-2 transition-colors duration-200 hover:text-ink data-[active]:bg-action data-[active]:text-action-ink',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-[13px]',
            )}
          >
            {item.label}
            {item.count !== undefined ? <span className="font-mono text-[11px] opacity-70">{item.count}</span> : null}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
