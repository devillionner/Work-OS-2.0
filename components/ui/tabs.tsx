'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root className={cn('flex min-h-0 flex-1 flex-col', className)} {...props} />;
}

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List className={cn('flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-4 hide-scrollbar', className)} {...props} />;
}

export function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn('relative inline-flex h-11 shrink-0 items-center whitespace-nowrap px-3 text-[13px] font-medium text-ink-2 transition-colors duration-200 hover:text-ink data-[active]:text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-ink after:opacity-0 data-[active]:after:opacity-100', className)}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn('min-h-0 flex-1 overflow-y-auto outline-none', className)} {...props} />;
}
