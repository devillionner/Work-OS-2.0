'use client';

import { useId, useRef, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';
import { ringAngles, type RingSegment } from '@/components/views/platforms/batch-ring-geometry';

const ORDER: readonly RingSegment[] = ['busy', 'failed', 'sent'];

/**
 * Кільце ходу партії з трьох сегментів по колу: відправлені (--ink, зелений лише при завершеній партії), не вдалося (--signal-hot), у
 * роботі (той самий світлий, ~40 %), решта — трек. Порядок шарів: трек → у роботі → не вдалося → відправлено; кожен сегмент починається
 * там, де скінчився попередній, без накладання, а шар без значення (0) не малюється зовсім.
 *
 * Дуга будується з двох половинок за статичними масками (права й ліва половина кільця), приріст — `rotate` половинки, початок
 * сегмента й його кінець — теж `rotate` груп (лише transform). Кінці дуги округлі: на початку нерухома точка (товщина = товщині треку),
 * на кінці точка в групі, що повертається разом із кутом; стик половинок на 6 годині перекриває точка того самого кольору, тож шва
 * немає. Малі частки мають мінімальну округлу дугу (довжиною в товщину треку), а не брусок. Перший показ без анімації (стан одразу),
 * далі зміни йдуть 0,32 с expo.out; prefers-reduced-motion — без анімації.
 */
export function BatchRing({ total, sent, failed, busy, ok, size = 72, stroke = 5, label, className, children }: {
  total: number;
  sent: number;
  failed: number;
  busy: number;
  /** Партія завершена й відправлено все. */
  ok: boolean;
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const root = useRef<SVGSVGElement>(null);
  const shown = useRef(false);
  const before = useRef<Record<RingSegment, number>>({ sent: 0, failed: 0, busy: 0 });
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const angles = ringAngles({ total, sent, failed, busy, stroke, radius });
  const signature = ORDER.map((key) => `${angles[key].start.toFixed(2)}:${angles[key].sweep.toFixed(2)}`).join('|');

  useGSAP(() => {
    const svg = root.current;
    if (!svg) return;
    const origin = `${center} ${center}`;
    const apply = (animate: boolean) => {
      for (const key of ORDER) {
        const { start, sweep } = angles[key];
        // Сегмент, що щойно з'явився (був 0), стає на місце одразу: рух із нуля показував би шов від половинок, що ще не розійшлись.
        const appear = before.current[key] <= 0;
        const targets: [string, number][] = [
          [`[data-start="${key}"]`, start],
          [`[data-end="${key}"]`, start + sweep],
          [`[data-half="${key}-right"]`, Math.min(sweep, 180)],
          [`[data-half="${key}-left"]`, Math.max(0, Math.min(sweep - 180, 180))],
        ];
        for (const [selector, rotation] of targets) {
          const node = svg.querySelector(selector);
          if (!node) continue;
          if (animate && !appear) gsap.to(node, { rotation, svgOrigin: origin, duration: 0.32, ease: 'expo.out', overwrite: 'auto' });
          else gsap.set(node, { rotation, svgOrigin: origin });
        }
        before.current[key] = sweep;
      }
    };
    const mm = matchMotion((reduced) => { apply(shown.current && !reduced); shown.current = true; });
    return () => mm.revert();
  }, { dependencies: [signature, size] });

  const left = `M ${center} ${center + radius} A ${radius} ${radius} 0 0 1 ${center} ${center - radius}`;
  const right = `M ${center} ${center - radius} A ${radius} ${radius} 0 0 1 ${center} ${center + radius}`;
  const paint: Record<RingSegment, { color: string; opacity: number }> = {
    sent: { color: ok ? 'var(--signal-ok)' : 'var(--ink)', opacity: 1 },
    failed: { color: 'var(--signal-hot)', opacity: 1 },
    busy: { color: 'var(--ink)', opacity: 0.4 },
  };
  const dot = stroke / 2;

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span className="sr-only">{label}</span>
      <svg ref={root} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-r`}><rect x={center} y={0} width={center} height={size} /></clipPath>
          <clipPath id={`${id}-l`}><rect x={0} y={0} width={center} height={size} /></clipPath>
        </defs>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {ORDER.filter((key) => angles[key].sweep > 0).map((key) => {
          const { color, opacity } = paint[key];
          const long = angles[key].sweep > 180;
          return (
            // Прозорість лежить на групі: перекриті точки й половинки одного кольору не темнішають.
            <g key={key} opacity={opacity}>
              <g data-start={key}>
                <circle cx={center} cy={center - radius} r={dot} fill={color} />
                {long ? <circle cx={center} cy={center + radius} r={dot} fill={color} /> : null}
                <g clipPath={`url(#${id}-r)`}><path data-half={`${key}-right`} d={left} fill="none" stroke={color} strokeWidth={stroke} /></g>
                {long ? <g clipPath={`url(#${id}-l)`}><path data-half={`${key}-left`} d={right} fill="none" stroke={color} strokeWidth={stroke} /></g> : null}
              </g>
              <g data-end={key}><circle cx={center} cy={center - radius} r={dot} fill={color} /></g>
            </g>
          );
        })}
      </svg>
      {children ? <span className="relative z-10 text-center text-[13px] font-medium leading-none tabular-nums">{children}</span> : null}
    </div>
  );
}
