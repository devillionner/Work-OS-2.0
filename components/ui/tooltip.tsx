'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

/** Підказка з назвою; тригером стає переданий елемент. */
export function Tooltip({ content, side = 'right', children }: { content: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={10} className="z-[80]">
          <TooltipPrimitive.Popup className="glass-strong frost rounded-full px-3 py-1.5 text-xs font-medium text-ink transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
