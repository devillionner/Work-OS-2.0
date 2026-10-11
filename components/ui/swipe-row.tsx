'use client';

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { gsap, prefersReducedMotion } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

type SwipeAction = { label: string; run: () => void };
const THRESHOLD = 72;
const LIMIT = 120;

/**
 * Свайп рядка на телефоні: вправо — головна дія, вліво — друга. Лише дотик; вібрація navigator.vibrate(8),
 * де підтримується. На ПК дії лишаються кнопками в самому рядку.
 */
export function SwipeRow({ children, right, left, className }: { children: ReactNode; right?: SwipeAction; left?: SwipeAction; className?: string }) {
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean; id: number } | null>(null);

  const settle = () => {
    const node = content.current;
    if (!node) return;
    gsap.to(node, { x: 0, duration: prefersReducedMotion() ? 0.01 : 0.24, ease: 'expo.out', onComplete: () => node.parentElement?.removeAttribute('data-swiping') });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || (!right && !left)) return;
    drag.current = { x: event.clientX, y: event.clientY, active: false, id: event.pointerId };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const node = content.current;
    if (!state || !node || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < 10) return;
      state.active = true;
      node.parentElement?.setAttribute('data-swiping', '');
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const allowed = dx > 0 ? Boolean(right) : Boolean(left);
    gsap.set(node, { x: allowed ? Math.max(-LIMIT, Math.min(LIMIT, dx)) : dx * 0.15 });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const node = content.current;
    drag.current = null;
    if (!state?.active || !node) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const x = Number(gsap.getProperty(node, 'x'));
    const action = x >= THRESHOLD ? right : x <= -THRESHOLD ? left : undefined;
    if (action) {
      navigator.vibrate?.(8);
      action.run();
    }
    settle();
  };

  return (
    <div className={cn('group relative overflow-hidden rounded-inner', className)}>
      {right ? <div aria-hidden="true" className="absolute inset-y-0 left-0 flex w-1/2 items-center bg-ok/15 px-5 text-sm font-medium text-ok opacity-0 group-data-[swiping]:opacity-100">{right.label}</div> : null}
      {left ? <div aria-hidden="true" className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-end bg-raised px-5 text-sm font-medium opacity-0 group-data-[swiping]:opacity-100">{left.label}</div> : null}
      <div
        ref={content}
        className="relative group-data-[swiping]:bg-solid"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
