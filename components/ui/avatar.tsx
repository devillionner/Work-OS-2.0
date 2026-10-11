import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Лише монохромні тони: різна прозорість --ink, без кольорової мішанини.
const TONES = ['bg-ink/[0.07]', 'bg-ink/[0.11]', 'bg-ink/[0.15]', 'bg-ink/[0.19]'] as const;

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0].slice(0, 2)).toUpperCase();
}

function tone(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function Avatar({ name, size = 36, className, ...props }: Omit<ComponentProps<'span'>, 'children'> & { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-ink', tone(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
