'use client';

import { useLayoutEffect, useState } from 'react';

const INTENT_MS = 600;

/** Керування однією колонкою, що гортається: звичайний об'єкт без React-реф, щоб стан жив поза рендером. */
function createColumn() {
  const positions = new Map<string, number>();
  let key = '';
  let node: HTMLDivElement | null = null;
  let cleanup: (() => void) | null = null;
  let lastIntent = 0;
  let dragging = false;

  const apply = () => {
    if (!node) return;
    const target = positions.get(key) ?? 0;
    if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
  };

  const scrollTo = (top: number) => {
    if (!node) return;
    positions.set(key, Math.max(0, top));
    node.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return {
    /** Колбек-реф колонки: підписується на прокрутку людини й на зміну розміру вмісту. */
    attach(element: HTMLDivElement | null) {
      cleanup?.();
      cleanup = null;
      node = element;
      if (!element) return;
      const touch = () => { lastIntent = Date.now(); };
      const down = () => { dragging = true; touch(); };
      const up = () => { dragging = false; };
      const onScroll = () => {
        if (dragging || Date.now() - lastIntent < INTENT_MS) positions.set(key, element.scrollTop);
      };
      element.addEventListener('wheel', touch, { passive: true });
      element.addEventListener('touchmove', touch, { passive: true });
      element.addEventListener('keydown', touch);
      element.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      element.addEventListener('scroll', onScroll, { passive: true });
      // Вміст вирос (список завантажився) — повертаємо запам'ятовану позицію.
      const observer = new ResizeObserver(() => { if (element.offsetParent !== null) apply(); });
      if (element.firstElementChild) observer.observe(element.firstElementChild);
      apply();
      cleanup = () => {
        element.removeEventListener('wheel', touch);
        element.removeEventListener('touchmove', touch);
        element.removeEventListener('keydown', touch);
        element.removeEventListener('pointerdown', down);
        window.removeEventListener('pointerup', up);
        element.removeEventListener('scroll', onScroll);
        observer.disconnect();
      };
    },
    sync(nextKey: string, active: boolean) {
      key = nextKey;
      if (active) apply();
    },
    scrollTo,
    /** Гортає до елемента всередині колонки з відступом зверху. */
    scrollToNode(target: HTMLElement | null) {
      if (!node || !target) return;
      scrollTo(node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top - 12);
    },
  };
}

/**
 * Колонка, що гортається окремо: позиція запам'ятовується за ключем (платформа, черга, вкладка) і повертається,
 * коли до цього ключа повертаються, коли розділ знову стає видимим (display:none скидає позицію) і коли вміст
 * вирісся після завантаження. Запам'ятовує лише прокрутку, яку зробила людина: стиснення списку під час
 * перезавантаження й live-оновлення позицію не змінюють.
 */
export function useColumnScroll(key: string, active: boolean) {
  const [column] = useState(createColumn);
  useLayoutEffect(() => { column.sync(key, active); }, [column, key, active]);
  return [column.attach, column.scrollTo, column.scrollToNode] as const;
}
