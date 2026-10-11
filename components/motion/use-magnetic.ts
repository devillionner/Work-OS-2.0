'use client';

import { useEffect, type RefObject } from 'react';
import { gsap, POINTER_FINE, prefersReducedMotion } from '@/components/motion/gsap';

type Entry = { node: HTMLElement; strength: number; radius: number; follow: { x: (value: number) => void; y: (value: number) => void } | null; near: boolean };

const entries = new Set<Entry>();
let frame = 0;
let lastEvent: PointerEvent | null = null;
let attached = false;

function tick() {
  frame = 0;
  const event = lastEvent;
  if (!event) return;
  for (const entry of entries) {
    const rect = entry.node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const reach = Math.max(rect.width, rect.height) / 2 + entry.radius;
    if (Math.hypot(dx, dy) <= reach) {
      if (!entry.follow) {
        gsap.killTweensOf(entry.node, 'x,y');
        entry.follow = {
          x: gsap.quickTo(entry.node, 'x', { duration: 0.35, ease: 'power3.out' }),
          y: gsap.quickTo(entry.node, 'y', { duration: 0.35, ease: 'power3.out' }),
        };
      }
      entry.near = true;
      entry.follow.x(dx * entry.strength);
      entry.follow.y(dy * entry.strength);
    } else if (entry.near) {
      entry.near = false;
      entry.follow = null;
      gsap.to(entry.node, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' });
    }
  }
}

function onMove(event: PointerEvent) {
  lastEvent = event;
  if (!frame) frame = requestAnimationFrame(tick);
}

function attach() {
  if (attached) return;
  attached = true;
  window.addEventListener('pointermove', onMove, { passive: true });
}

function detach() {
  if (entries.size || !attached) return;
  attached = false;
  window.removeEventListener('pointermove', onMove);
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/** Магнітна кнопка: сила 0.3, радіус захоплення 80px, повернення elastic.out(1, 0.4). Лише (pointer: fine). */
export function useMagnetic(ref: RefObject<HTMLElement | null>, { strength = 0.3, radius = 80, enabled = true } = {}) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || !window.matchMedia(POINTER_FINE).matches || prefersReducedMotion()) return;
    const entry: Entry = { node, strength, radius, follow: null, near: false };
    entries.add(entry);
    attach();
    return () => {
      entries.delete(entry);
      gsap.killTweensOf(node, 'x,y');
      gsap.set(node, { clearProps: 'x,y' });
      detach();
    };
  }, [ref, strength, radius, enabled]);
}
