'use client';

import { type RefObject } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';

const STAGGER_LIMIT = 8;

/**
 * Поява блоків із `[data-reveal]` лише при першому показі: y 8 → 0 і opacity за 240 мс, короткий стагер.
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
        { y: 8, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.025, duration: 0.24, ease: 'power3.out', clearProps: 'transform,opacity' },
      );
      if (rest.length) {
        gsap.fromTo(
          rest,
          { y: 8, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.24, delay: lead.length * 0.025, ease: 'power3.out', clearProps: 'transform,opacity' },
        );
      }
    });
    return () => mm.revert();
  }, { scope, dependencies: [key] });
}
