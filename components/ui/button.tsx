'use client';

import { useRef } from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { useMagnetic } from '@/components/motion/use-magnetic';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,opacity] duration-200 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[1.15em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        action: 'bg-action text-action-ink hover:opacity-90',
        ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
        outline: 'border border-line-strong text-ink hover:bg-raised',
        icon: 'p-0 text-ink-2 hover:bg-raised hover:text-ink',
        fab: 'bg-action p-0 text-action-ink shadow-float hover:opacity-90',
      },
      size: { sm: 'h-8 px-3.5 text-[13px]', md: 'h-10 px-[18px] text-sm', lg: 'h-12 px-6 text-[15px]', xl: 'h-14 px-7 text-base' },
      tone: { default: '', danger: 'text-hot hover:text-hot' },
    },
    compoundVariants: [
      { variant: 'icon', size: 'sm', className: 'size-8 px-0' },
      { variant: 'icon', size: 'md', className: 'size-10 px-0' },
      { variant: 'icon', size: 'lg', className: 'size-12 px-0' },
      { variant: 'icon', size: 'xl', className: 'size-14 px-0' },
      { variant: 'fab', size: 'sm', className: 'size-8 px-0' },
      { variant: 'fab', size: 'md', className: 'size-10 px-0' },
      { variant: 'fab', size: 'lg', className: 'size-12 px-0' },
      { variant: 'fab', size: 'xl', className: 'size-14 px-0' },
      { variant: 'outline', tone: 'danger', className: 'border-hot/50 hover:bg-hot/10' },
    ],
    defaultVariants: { variant: 'outline', size: 'md', tone: 'default' },
  },
);

export type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & {
  /** Магнітне притягання до курсора (лише (pointer: fine)). */
  magnetic?: boolean;
  /** Блокує кнопку й ставить aria-busy під час запиту. */
  busy?: boolean;
};

export function Button({ className, variant, size, tone, magnetic = false, busy = false, disabled, ref, ...props }: ButtonProps) {
  const inner = useRef<HTMLButtonElement | null>(null);
  useMagnetic(inner, { enabled: magnetic });
  return (
    <ButtonPrimitive
      {...props}
      ref={(node: HTMLButtonElement | null) => {
        inner.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as { current: HTMLButtonElement | null }).current = node;
      }}
      data-slot="button"
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cn(buttonVariants({ variant, size, tone }), className)}
    />
  );
}
