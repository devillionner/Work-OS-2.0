'use client';

import { useEffect, type RefObject } from 'react';
import { POINTER_FINE, prefersReducedMotion } from '@/components/motion/gsap';

/**
 * Один делегований pointermove на полотні з rAF-тротлінгом пише --mx/--my у картку `.spot` під курсором.
 */
export function useSpotlight(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = container.current;
    if (!root || !window.matchMedia(POINTER_FINE).matches || prefersReducedMotion()) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const event = last;
      if (!event || !(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>('.spot');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };
    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [container]);
}
