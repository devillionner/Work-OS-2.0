'use client';

import type { ReactNode } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cn } from '@/lib/utils';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({ children, className, align = 'end', side = 'bottom' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} side={side} sideOffset={8} className="z-[70] outline-none">
        <MenuPrimitive.Popup className={cn('glass-strong frost shadow-float min-w-48 origin-[var(--transform-origin)] rounded-inner p-1.5 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0', className)}>
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item className={cn('flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 text-sm text-ink outline-none data-[highlighted]:bg-raised data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:text-ink-2', className)} {...props} />;
}

export function MenuSeparator({ className }: { className?: string }) {
  return <MenuPrimitive.Separator className={cn('my-1.5 h-px bg-line', className)} />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-xs font-medium text-ink-2">{children}</div>;
}
