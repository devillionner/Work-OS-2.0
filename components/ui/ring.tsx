'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

export type RingTone = 'ok' | 'warn' | 'hot' | 'ink' | 'rail';

const STROKE: Record<RingTone, string> = { ok: 'var(--signal-ok)', warn: 'var(--signal-warn)', hot: 'var(--signal-hot)', ink: 'var(--ink)', rail: 'var(--rail-ink)' };

/** Тон кільця цілі: ≥ 100% — ok, у темпі — warn, відстає — hot. `expected` — частка цілі, яка вже мала б бути виконана. */
export function goalTone(value: number, expected?: number): RingTone {
  if (value >= 1) return 'ok';
  if (expected === undefined) return 'ink';
  return value >= expected * 0.9 ? 'warn' : 'hot';
}

export function Ring({ value, tone = 'ink', size = 56, stroke = 4, label, track = 'var(--line)', className, children }: {
  value: number;
  tone?: RingTone;
  size?: number;
  stroke?: number;
  label?: string;
  track?: string;
  className?: string;
  children?: ReactNode;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const ratio = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const radius = (size - stroke) / 2;

  useGSAP(() => {
    const node = arc.current;
    if (!node) return;
    const mm = matchMotion((reduced) => {
      if (reduced) { gsap.set(node, { strokeDashoffset: 1 - ratio }); return; }
      gsap.to(node, { strokeDashoffset: 1 - ratio, duration: 0.5, ease: 'expo.out' });
    });
    return () => mm.revert();
  }, { dependencies: [ratio] });

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span className="sr-only">{label ?? `${Math.round(ratio * 100)}%`}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          ref={arc}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1}
        />
      </svg>
      {children ? <span className="relative z-10 text-center text-[11px] font-medium leading-none">{children}</span> : null}
    </div>
  );
}
