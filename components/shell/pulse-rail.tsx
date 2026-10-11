'use client';

import { useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { gsap, matchMotion, useGSAP } from '@/components/motion/gsap';
import { Draggable } from '@/components/motion/draggable';
import { Ring, type RingTone } from '@/components/ui/ring';
import { cn } from '@/lib/utils';

export type PulseRing = { key: string; label: string; count: number; target: number | null; tone: RingTone };

const WIDTH = 88;

/**
 * Чорна вигнута панель біля правого краю (телефон): ручка 6×48px, свайп вліво або тап розгортає 88px.
 * Усередині — кільця цілей дня з відсотками й шестерня швидких налаштувань.
 */
export function PulseRail({ rings, onOpenSettings }: { rings: PulseRing[]; onOpenSettings: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    const mm = matchMotion((reduced) => {
      const snap = (to: number) => {
        openRef.current = to === 0;
        setOpen(to === 0);
        gsap.to(node, { x: to, duration: reduced ? 0.01 : 0.28, ease: 'expo.out' });
      };
      gsap.set(node, { x: WIDTH });
      // Швидкість свайпу рахуємо самі: InertiaPlugin не підключаємо.
      let last = { x: WIDTH, t: performance.now(), velocity: 0 };
      const [drag] = Draggable.create(node, {
        type: 'x',
        bounds: { minX: 0, maxX: WIDTH },
        edgeResistance: 0.9,
        dragClickables: true,
        minimumMovement: 4,
        onPress: () => { last = { x: Number(gsap.getProperty(node, 'x')), t: performance.now(), velocity: 0 }; },
        onDrag: () => {
          const x = Number(gsap.getProperty(node, 'x'));
          const t = performance.now();
          last = { x, t, velocity: (x - last.x) / Math.max(1, t - last.t) };
        },
        onClick: () => snap(openRef.current ? WIDTH : 0),
        onDragEnd: () => {
          const x = Number(gsap.getProperty(node, 'x'));
          if (Math.abs(last.velocity) > 0.5) snap(last.velocity < 0 ? 0 : WIDTH);
          else snap(x < WIDTH / 2 ? 0 : WIDTH);
        },
      });
      return () => drag.kill();
    });
    return () => mm.revert();
  }, { scope: root });

  return (
    <div
      ref={root}
      className="on-rail fixed right-0 z-20 text-rail-ink"
      style={{ top: '50%', width: WIDTH, height: 'min(420px, 62dvh)', marginTop: 'calc(min(420px, 62dvh) / -2)', touchAction: 'pan-y' }}
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full text-rail" viewBox="0 0 88 420" preserveAspectRatio="none">
        <path fill="currentColor" d="M88 0V420H44C24 420 20 400 24 380C29 356 6 346 6 318V102C6 74 29 64 24 40C20 20 24 0 44 0Z" />
      </svg>
      <span aria-hidden="true" className={cn('absolute -left-3.5 top-1/2 h-12 w-1.5 -translate-y-1/2 rounded-full bg-rail transition-opacity duration-200', open && 'opacity-0')} />
      <div className="relative flex h-full flex-col items-center justify-between py-7 pl-4 pr-2" inert={open ? undefined : true}>
        <h2 className="sr-only">Цілі дня</h2>
        <ul className="m-0 flex list-none flex-col items-center gap-4 p-0">
          {rings.map((ring) => {
            const ratio = ring.target ? ring.count / ring.target : 0;
            return (
              <li key={ring.key} className="flex flex-col items-center gap-1.5">
                <Ring value={ring.target ? ratio : 0} tone={ring.target ? ring.tone : 'rail'} track="var(--rail-line)" size={48} stroke={4} label={`${ring.label}: ${ring.count}${ring.target ? ` із ${ring.target}` : ''}`}>
                  {ring.target ? null : ring.count}
                </Ring>
                <span className="font-mono text-[11px] text-rail-ink-2">{ring.target ? `${Math.round(ratio * 100)}%` : ring.label}</span>
              </li>
            );
          })}
        </ul>
        <button type="button" aria-label="Швидкі налаштування" onClick={onOpenSettings} className="inline-grid size-10 [@media(pointer:coarse)]:size-11 place-items-center rounded-full text-rail-ink-2 transition-colors hover:bg-rail-ink/10 active:scale-95">
          <Settings2 aria-hidden="true" strokeWidth={1.5} className="size-5" />
        </button>
      </div>
    </div>
  );
}
