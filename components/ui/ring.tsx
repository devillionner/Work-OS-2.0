'use client';

import { useRef, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

export type RingTone = 'ok' | 'warn' | 'hot' | 'ink' | 'rail';

const STROKE: Record<RingTone, string> = { ok: 'var(--signal-ok)', warn: 'var(--signal-warn)', hot: 'var(--signal-hot)', ink: 'var(--ink)', rail: 'var(--rail-ink)' };

/** Колір числа поруч із кільцем: лише warn і hot, решта лишається звичайною. */
export const toneTextClass = (tone: RingTone): string => (tone === 'warn' ? 'text-warn' : tone === 'hot' ? 'text-hot' : '');

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

  // Анімуємо саме атрибут: CSSPlugin GSAP округлює px, і `stroke-dashoffset: 0.27` став би inline `0px` (повне коло) чи `1px` (порожнє).
  // Перший показ іде від 0 (початковий атрибут), далі від поточного значення до нового: без скидання, без revert.
  useGSAP(() => {
    const node = arc.current;
    if (!node) return;
    const mm = matchMotion((reduced) => {
      if (reduced) gsap.set(node, { attr: { 'stroke-dashoffset': 1 - ratio } });
      else gsap.to(node, { attr: { 'stroke-dashoffset': 1 - ratio }, duration: 0.32, ease: 'expo.out', overwrite: 'auto' });
    });
    return () => { mm.kill(); };
  }, { dependencies: [ratio] });

  // Нуль при відставанні: трек кольору тону з низькою непрозорістю, інакше червоне «0» виглядає нейтральним.
  const lagging = ratio === 0 && (tone === 'warn' || tone === 'hot');

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span className="sr-only">{label ?? `${Math.round(ratio * 100)}%`}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={lagging ? STROKE[tone] : track} strokeOpacity={lagging ? 0.32 : undefined} strokeWidth={stroke} />
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
