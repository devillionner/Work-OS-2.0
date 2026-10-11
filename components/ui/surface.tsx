import { createElement, type ComponentProps, type ElementType } from 'react';
import { cn } from '@/lib/utils';

export type SurfaceVariant = 'glass' | 'glass-strong' | 'solid' | 'sunken' | 'inverted';
export type SurfaceRadius = 'frame' | 'panel' | 'card' | 'inner' | 'field';

const VARIANT: Record<SurfaceVariant, string> = {
  glass: 'glass',
  'glass-strong': 'glass-strong',
  solid: 'solid',
  sunken: 'sunken',
  inverted: 'inverted',
};

const RADIUS: Record<SurfaceRadius, string> = {
  frame: 'rounded-frame',
  panel: 'rounded-panel',
  card: 'rounded-card',
  inner: 'rounded-inner',
  field: 'rounded-field',
};

type OwnProps = {
  variant?: SurfaceVariant;
  radius?: SurfaceRadius;
  /** backdrop-filter: лише полотно, Inspector, Sheet і меню (≤ 2 шари в кадрі). */
  blur?: boolean;
  /** Підйом на hover і стиснення при натисканні. */
  lift?: boolean;
};

export type SurfaceProps<T extends ElementType> = OwnProps & { as?: T } & Omit<ComponentProps<T>, keyof OwnProps | 'as'>;

export function Surface<T extends ElementType = 'div'>({ as, variant = 'glass', radius = 'card', blur = false, lift = false, className, ...props }: SurfaceProps<T>) {
  return createElement(as ?? 'div', {
    'data-surface': variant,
    className: cn(VARIANT[variant], RADIUS[radius], blur && 'frost', lift && 'lift', className),
    ...props,
  });
}
