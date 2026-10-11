'use client';

import { useSyncExternalStore } from 'react';

export const PHONE = '(max-width: 767px)';
export const WIDE = '(min-width: 1440px)';
export const DESKTOP = '(min-width: 1024px)';

/** Підписка на media query без setState в ефектах; на сервері завжди false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
