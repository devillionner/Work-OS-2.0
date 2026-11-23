'use client';

import { useRef, useState, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

export type RingTone = 'ok' | 'warn' | 'hot' | 'ink' | 'rail';

const STROKE: Record<RingTone, string> = { ok: 'var(--signal-ok)', warn: 'var(--signal-warn)', hot: 'var(--signal-hot)', ink: 'var(--ink)', rail: 'var(--rail-ink)' };

/** Колір числа поруч із кільцем: лише warn і hot, решта лишається звичайною. */
export const toneTextClass = (tone: RingTone): string => (tone === 'warn' ? 'text-warn' : tone === 'hot' ? 'text-hot' : '');

/**
 * Відсоток біля кільця: до виконання цілі ніколи не «100%» (floor, 139/140 → 99%), при ratio ≥ 1 — фактичний відсоток (≥ 100%).
 * Крихта 1e-9 гасить похибку на кшталт 0.29 × 100 = 28.999….
 */
export function ratioPercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return ratio >= 1 ? Math.round(ratio * 100) : Math.floor(ratio * 100 + 1e-9);
}

/**
 * Частка кола, яку справді малюємо. Круглі кінці виходять за межі дуги на stroke / 2, тож щілина 1 % зникала б під ними:
 * повне коло лише при ratio ≥ 1, інакше дуга обмежена так, щоб між кінцями лишалось не менше max(2px, stroke × 0.6).
 */
export function drawnFraction(ratio: number, size: number, stroke: number): number {
  if (ratio >= 1) return 1;
  if (ratio <= 0) return 0;
  const circumference = 2 * Math.PI * ((size - stroke) / 2);
  const gap = Math.max(2, stroke * 0.6);
  return Math.min(ratio, Math.max(0, 1 - (stroke + gap) / circumference));
}

// Остання намальована частка за id: перший показ id за сесію сторінки наповнюється від нуля, повернення в розділ стартує з цього місця.
const lastDrawn = new Map<string, number>();

export function Ring({ value, tone = 'ink', size = 56, stroke = 4, label, track = 'var(--line)', className, children, id }: {
  /** Стабільний ключ кільця (наприклад `today:publications`): за ним пам'ятається останнє значення, щоб при поверненні в розділ воно не наповнювалось заново. */
  id?: string;
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
  const drawn = drawnFraction(ratio, size, stroke);
  // Початковий атрибут береться з пам'яті (до першого малювання, без кадру з нуля); перший показ id — порожнє кільце.
  const [initialOffset] = useState(() => 1 - ((id ? lastDrawn.get(id) : undefined) ?? 0));

  // Анімуємо саме атрибут: CSSPlugin GSAP округлює px, і `stroke-dashoffset: 0.27` став би inline `0px` чи `1px`.
  // Далі від поточного значення до нового: без скидання, без revert. Reduced motion — одразу.
  useGSAP(() => {
    const node = arc.current;
    if (!node) return;
    if (id) lastDrawn.set(id, drawn);
    const target = 1 - drawn;
    // Нульова дуга з круглими кінцями малювала б крапку: при нулі ховаємо її прозорістю.
    const opacity = drawn > 0 ? 1 : 0;
    const mm = matchMotion((reduced) => {
      if (reduced) gsap.set(node, { attr: { 'stroke-dashoffset': target, 'stroke-opacity': opacity } });
      else if (Math.abs(Number(node.getAttribute('stroke-dashoffset')) - target) > 1e-6) gsap.to(node, { attr: { 'stroke-dashoffset': target, 'stroke-opacity': opacity }, duration: 0.32, ease: 'expo.out', overwrite: 'auto' });
    });
    return () => { mm.kill(); };
  }, { dependencies: [drawn] });

  // Нуль при відставанні: трек кольору тону з низькою непрозорістю, інакше червоне «0» виглядає нейтральним.
  const lagging = ratio === 0 && (tone === 'warn' || tone === 'hot');

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span className="sr-only">{label ?? `${ratioPercent(ratio)}%`}</span>
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
          strokeDashoffset={initialOffset}
          strokeOpacity={initialOffset >= 1 ? 0 : 1}
        />
      </svg>
      {children ? <span className="relative z-10 text-center text-[11px] font-medium leading-none">{children}</span> : null}
    </div>
  );
}
