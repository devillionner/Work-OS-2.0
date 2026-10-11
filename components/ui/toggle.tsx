'use client';

import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2.5 [@media(pointer:coarse)]:after:content-[""] border border-line-strong bg-sunken p-0.5 transition-colors duration-200 data-[checked]:border-transparent data-[checked]:bg-action disabled:opacity-45', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[18px] rounded-full bg-ink-2 transition-transform duration-200 data-[checked]:translate-x-5 data-[checked]:bg-action-ink" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn('relative inline-flex size-5 shrink-0 items-center justify-center rounded-md [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-3 [@media(pointer:coarse)]:after:content-[""] border border-line-strong bg-sunken transition-colors duration-200 data-[checked]:border-transparent data-[checked]:bg-action disabled:opacity-45', className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-action-ink"><Check aria-hidden="true" strokeWidth={2} className="size-3.5" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
