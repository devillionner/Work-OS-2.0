'use client';

import { useEffect } from 'react';

const IDLE_MS = 700;

/** Позначає контейнер, що прокручується, атрибутом `data-scrolling`: повзунок стає виразнішим на час скролу. */
export function useScrollActivity() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const target = event.target instanceof Element ? event.target : document.documentElement;
      if (!target.hasAttribute('data-scrolling')) target.setAttribute('data-scrolling', '');
      window.clearTimeout(timers.get(target));
      timers.set(target, window.setTimeout(() => target.removeAttribute('data-scrolling'), IDLE_MS));
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
}
