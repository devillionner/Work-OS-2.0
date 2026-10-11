'use client';

import { useEffect, useRef } from 'react';
import { gsap, prefersReducedMotion } from '@/components/motion/gsap';

/**
 * Анімує зміну числа (0.6 с, snap до цілого) лише коли значення справді змінилось.
 * Повертає ref для елемента, чий textContent оновлюється без рендерів.
 */
export function useCountUp<T extends HTMLElement>(value: number, format: (value: number) => string = (next) => String(next)) {
  const ref = useRef<T | null>(null);
  const shown = useRef(value);
  const formatRef = useRef(format);
  useEffect(() => { formatRef.current = format; });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (shown.current === value) {
      node.textContent = formatRef.current(value);
      return;
    }
    if (prefersReducedMotion()) {
      shown.current = value;
      node.textContent = formatRef.current(value);
      return;
    }
    const state = { v: shown.current };
    const tween = gsap.to(state, {
      v: value,
      duration: 0.3,
      ease: 'power3.out',
      snap: { v: 1 },
      onUpdate: () => {
        shown.current = state.v;
        node.textContent = formatRef.current(state.v);
      },
      onComplete: () => {
        shown.current = value;
        node.textContent = formatRef.current(value);
      },
    });
    return () => { tween.kill(); };
  }, [value]);

  return ref;
}
