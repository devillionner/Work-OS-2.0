'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Підказка горизонтальної прокрутки: край, за яким є продовження, тане (`edge-fade-*` у globals.css).
 * Повертає клас для контейнера з `overflow-x-auto`; без переповнення — порожній рядок.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>): string {
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const left = node.scrollLeft > 4;
      const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 4;
      setEdge((current) => (current.left === left && current.right === right ? current : { left, right }));
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => { node.removeEventListener('scroll', update); observer.disconnect(); };
  }, [ref]);
  return edge.left && edge.right ? 'edge-fade-lr' : edge.right ? 'edge-fade-r' : edge.left ? 'edge-fade-l' : '';
}
