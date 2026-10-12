'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Розтягує елемент на всю висоту прокручуваного `main` (за мінусом його відступів): шкала дня на ПК живе у вікні фіксованої
 * висоти, а не росте разом із вмістом. Висота стежить за розміром `main`; на низькому екрані лишається мінімум.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, enabled: boolean, min = 520) {
  useLayoutEffect(() => {
    const node = ref.current;
    const main = node?.closest('main');
    if (!node || !main || !enabled) return;
    const apply = () => {
      const style = getComputedStyle(main);
      node.style.height = `${Math.max(min, main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(main);
    return () => { observer.disconnect(); node.style.height = ''; };
  }, [ref, enabled, min]);
}
