'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { useLiveMessage, useLiveStatus } from '@/components/shell/use-live';
import { cn } from '@/lib/utils';

/**
 * Райдужний орб стану live-каналу: повільно обертається, поки канал підключений; сірий і статичний у фолбеку;
 * короткий імпульс на кожну вхідну подію.
 */
export function LiveOrb({ size = 36, children, className }: { size?: number; children?: ReactNode; className?: string }) {
  const { connected } = useLiveStatus();
  const disc = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useGSAP(() => {
    const node = ring.current;
    if (!node || !connected) return;
    const mm = matchMotion((reduced) => {
      if (reduced) return;
      gsap.to(node, { rotation: 360, duration: 20, ease: 'none', repeat: -1 });
    });
    return () => mm.revert();
  }, { dependencies: [connected] });

  useLiveMessage(() => {
    const node = disc.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(node, { scale: 1 }, { scale: 1.25, duration: 0.18, ease: 'power2.out', yoyo: true, repeat: 1 });
  });

  return (
    <span ref={disc} className={cn('relative inline-grid shrink-0 place-items-center rounded-full', className)} style={{ width: size, height: size }} data-live={connected ? 'on' : 'off'}>
      <span
        ref={ring}
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ background: connected ? 'var(--iris)' : 'color-mix(in srgb, var(--rail-ink) 28%, transparent)' }}
      />
      <span aria-hidden="true" className="absolute inset-[3px] rounded-full bg-rail" />
      <span aria-hidden="true" className="absolute inset-[7px] rounded-full opacity-90" style={{ background: connected ? 'var(--iris)' : 'color-mix(in srgb, var(--rail-ink) 22%, transparent)', filter: 'blur(3px)' }} />
      {children ? <span className="relative text-[11px] font-medium text-rail-ink">{children}</span> : null}
    </span>
  );
}
