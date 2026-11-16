'use client';

import { useId, useRef, type ReactNode } from 'react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

type Segment = 'sent' | 'failed' | 'busy';

/**
 * Кільце ходу партії з трьох сегментів по колу: відправлені (--ink), не вдалося (--signal-hot), у роботі (той самий світлий, ~40 %),
 * решта — трек. Дуга будується з двох половинок, що повертаються (`rotate`), а не через stroke-dashoffset: приріст сегмента це
 * transform. Кожна половинка лежить за статичною маскою (права чи ліва половина кільця), і поворот виводить її з-за маски:
 * права половина показує sweep 0–180° від початку сегмента, ліва — 180–360°. Початок сегмента теж поворот зовнішньої групи.
 * Перший показ без анімації (стан одразу), далі зміни йдуть 0,32 с expo.out; prefers-reduced-motion — без анімації.
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
  const center = size / 2;
  const radius = (size - stroke) / 2;

  const safe = Math.max(1, total);
  const sweep = (count: number) => Math.max(0, Math.min(360, (count / safe) * 360));
  const sentAngle = sweep(sent);
  const failedAngle = Math.min(sweep(failed), 360 - sentAngle);
  const busyAngle = Math.min(sweep(busy), 360 - sentAngle - failedAngle);
  const angles: Record<Segment, { start: number; sweep: number }> = {
    sent: { start: 0, sweep: sentAngle },
    failed: { start: sentAngle, sweep: failedAngle },
    busy: { start: sentAngle + failedAngle, sweep: busyAngle },
  };

  useGSAP(() => {
    const svg = root.current;
    if (!svg) return;
    const origin = `${center} ${center}`;
    const apply = (animate: boolean) => {
      for (const key of ['sent', 'failed', 'busy'] as const) {
        const { start, sweep: arc } = angles[key];
        const vars: [string, number][] = [
          [`[data-start="${key}"]`, start],
          [`[data-half="${key}-right"]`, Math.min(arc, 180)],
          [`[data-half="${key}-left"]`, Math.max(0, Math.min(arc - 180, 180))],
        ];
        for (const [selector, rotation] of vars) {
          const node = svg.querySelector(selector);
          if (!node) continue;
          if (animate) gsap.to(node, { rotation, svgOrigin: origin, duration: 0.32, ease: 'expo.out', overwrite: 'auto' });
          else gsap.set(node, { rotation, svgOrigin: origin });
        }
      }
    };
    const mm = matchMotion((reduced) => { apply(shown.current && !reduced); shown.current = true; });
    return () => mm.revert();
  }, { dependencies: [sentAngle, failedAngle, busyAngle, size] });

  const left = `M ${center} ${center + radius} A ${radius} ${radius} 0 0 1 ${center} ${center - radius}`;
  const right = `M ${center} ${center - radius} A ${radius} ${radius} 0 0 1 ${center} ${center + radius}`;
  const paint: Record<Segment, { color: string; opacity: number }> = {
    sent: { color: ok ? 'var(--signal-ok)' : 'var(--ink)', opacity: 1 },
    failed: { color: 'var(--signal-hot)', opacity: 1 },
    busy: { color: 'var(--ink)', opacity: 0.4 },
  };

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span className="sr-only">{label}</span>
      <svg ref={root} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        <defs>
          {/* Половини кільця, що лишаються видимими: права (x ≥ центр) і ліва; маски статичні, рухаються лише дуги за ними. */}
          <clipPath id={`${id}-r`}><rect x={center} y={0} width={center} height={size} /></clipPath>
          <clipPath id={`${id}-l`}><rect x={0} y={0} width={center} height={size} /></clipPath>
        </defs>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {(['sent', 'failed', 'busy'] as const).map((key) => (
          <g key={key} data-start={key} opacity={paint[key].opacity} fill="none" stroke={paint[key].color} strokeWidth={stroke}>
            <g clipPath={`url(#${id}-r)`}><path data-half={`${key}-right`} d={left} /></g>
            <g clipPath={`url(#${id}-l)`}><path data-half={`${key}-left`} d={right} /></g>
          </g>
        ))}
      </svg>
      {children ? <span className="relative z-10 text-center text-[11px] font-medium leading-none">{children}</span> : null}
    </div>
  );
}
