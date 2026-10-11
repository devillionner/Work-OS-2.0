'use client';

import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

// Одноразова реєстрація: GSAP і useGSAP тільки на клієнті, спільні значення за замовчуванням.
let configured = false;
if (!configured && typeof window !== 'undefined') {
  configured = true;
  gsap.registerPlugin(useGSAP);
  gsap.defaults({ ease: 'expo.out', duration: 0.42 });
}

export const MOTION_FULL = '(prefers-reduced-motion: no-preference)';
export const MOTION_REDUCED = '(prefers-reduced-motion: reduce)';
export const POINTER_FINE = '(pointer: fine)';

/**
 * gsap.matchMedia із двома гілками: повний рух і prefers-reduced-motion (лише миттєві fade).
 * Повертає matchMedia, який треба `revert()` у cleanup.
 */
export function matchMotion(setup: (reduced: boolean) => void | (() => void)): gsap.MatchMedia {
  const mm = gsap.matchMedia();
  mm.add({ full: MOTION_FULL, reduced: MOTION_REDUCED }, (context) => setup(Boolean(context.conditions?.reduced)));
  return mm;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOTION_REDUCED).matches;
}

export { gsap, useGSAP };
