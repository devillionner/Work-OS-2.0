'use client';

import { type RefObject } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';

const STAGGER_LIMIT = 12;

/**
 * Поява блоків із `[data-reveal]`: y 14 → 0, opacity, blur 8px → 0, stagger 0.035.
 * У стагері не більше 12 елементів, решта з'являються разом. `key` перезапускає поки значення змінюється
 * (наприклад, коли дані завантажились і блоки з'явились у DOM).
 */
export function useReveal(scope: RefObject<HTMLElement | null>, key: unknown = true) {
  useGSAP(() => {
    const root = scope.current;
    if (!root || !key) return;
    const all = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]:not([data-revealed])'));
    if (!all.length) return;
    all.forEach((node) => node.setAttribute('data-revealed', ''));
    const lead = all.slice(0, STAGGER_LIMIT);
    const rest = all.slice(STAGGER_LIMIT);
    const mm = matchMotion((reduced) => {
      if (reduced) {
        gsap.fromTo(all, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none', clearProps: 'opacity' });
        return;
      }
      gsap.fromTo(
        lead,
        { y: 14, opacity: 0, filter: 'blur(8px)' },
        { y: 0, opacity: 1, filter: 'blur(0px)', stagger: 0.035, duration: 0.42, ease: 'expo.out', clearProps: 'transform,filter,opacity' },
      );
      if (rest.length) {
        gsap.fromTo(
          rest,
          { y: 14, opacity: 0, filter: 'blur(8px)' },
          { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.42, delay: lead.length * 0.035, ease: 'expo.out', clearProps: 'transform,filter,opacity' },
        );
      }
    });
    return () => mm.revert();
  }, { scope, dependencies: [key] });
}
