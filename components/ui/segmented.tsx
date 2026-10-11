'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string> = { value: T; label: ReactNode; count?: ReactNode };

/** Сегментований pill-перемикач на base-ui Tabs (клавіатура й aria — з коробки); індикатор ковзає. Контент рендерить споживач. */
export function Segmented<T extends string>({ value, onValueChange, items, label, size = 'md', className }: {
  value: T;
  onValueChange: (value: T) => void;
  items: ReadonlyArray<SegmentedItem<T>>;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  // Активна вкладка завжди в зоні видимості, коли список прокручується по горизонталі.
  useEffect(() => {
    const node = list.current;
    const active = node?.querySelector<HTMLElement>('[role="tab"][data-active]');
    if (!node || !active) return;
    const left = active.offsetLeft - 8;
    const right = active.offsetLeft + active.offsetWidth + 8;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (left < node.scrollLeft) node.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    else if (right > node.scrollLeft + node.clientWidth) node.scrollTo({ left: right - node.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }, [value]);

  return (
    <TabsPrimitive.Root className="min-w-0 max-w-full" value={value} onValueChange={(next) => onValueChange(next as T)}>
      <TabsPrimitive.List
        ref={list}
        aria-label={label}
        className={cn('relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-sunken p-1 hide-scrollbar', className)}
      >
        <TabsPrimitive.Indicator
          className="pointer-events-none absolute left-0 rounded-full bg-action transition-[translate,width] duration-200 ease-out"
          style={{ top: 'var(--active-tab-top)', height: 'var(--active-tab-height)', width: 'var(--active-tab-width)', translate: 'var(--active-tab-left) 0' }}
        />
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            className={cn(
              'relative z-10 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full font-medium text-ink-2 transition-colors duration-200 hover:text-ink data-[active]:text-action-ink',
              size === 'sm' ? 'h-7 px-3 text-xs [@media(pointer:coarse)]:h-9' : 'h-8 px-4 text-[13px] [@media(pointer:coarse)]:h-10',
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
