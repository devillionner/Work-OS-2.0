'use client';

import { useEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { gsap, prefersReducedMotion } from '@/components/motion/gsap';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const HALF = 0.55;
const FULL = 0.92;
const CLOSE_VELOCITY = 0.5; // px/ms

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** bottom — телефон (drag-to-dismiss, зупинки 55% / 92%); right — планшет і вузький десктоп. */
  side?: 'bottom' | 'right';
  snap?: 'half' | 'full';
  actions?: ReactNode;
  /** Вкладки під заголовком: поза прокручуваною областю. */
  tabs?: ReactNode;
  /** Зміна ключа перемикає вміст crossfade-ом і повертає прокрутку на початок. */
  contentKey?: string;
  footer?: ReactNode;
  /** Контейнер для вкладених форм поверх панелі (див. Panel). */
  overlayRef?: (element: HTMLDivElement | null) => void;
  children: ReactNode;
  className?: string;
};

export function Sheet({ open, onOpenChange, title, description, side = 'bottom', snap = 'full', actions, tabs, contentKey, footer, overlayRef, children, className }: Props) {
  const popup = useRef<HTMLDivElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [contentKey]);
  const drag = useRef<{ startY: number; base: number; lastY: number; lastT: number; velocity: number } | null>(null);

  const halfOffset = () => {
    const height = popup.current?.offsetHeight ?? 0;
    return height * (1 - HALF / FULL);
  };

  const settle = (node: HTMLDivElement) => {
    const base = snap === 'half' ? halfOffset() : 0;
    gsap.set(node, { y: base });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (side !== 'bottom' || (event.target as HTMLElement).closest('button')) return;
    const node = popup.current;
    if (!node) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = Number(gsap.getProperty(node, 'y')) || 0;
    drag.current = { startY: event.clientY, base, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
    gsap.killTweensOf(node, 'y');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const node = popup.current;
    if (!state || !node) return;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    gsap.set(node, { y: Math.max(0, state.base + (event.clientY - state.startY)) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const node = popup.current;
    drag.current = null;
    if (!state || !node) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const height = node.offsetHeight;
    const current = Number(gsap.getProperty(node, 'y')) || 0;
    const half = halfOffset();
    if (state.velocity > CLOSE_VELOCITY || current > half + (height - half) * 0.5) { onOpenChange(false); return; }
    const target = state.velocity < -CLOSE_VELOCITY ? 0 : Math.abs(current) < Math.abs(current - half) ? 0 : half;
    gsap.to(node, { y: target, duration: prefersReducedMotion() ? 0.01 : 0.3, ease: 'power3.out' });
  };

  const bottom = side === 'bottom';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-scrim transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          ref={(node: HTMLDivElement | null) => { popup.current = node; if (node && open) settle(node); }}
          className={cn(
            'glass-strong frost shadow-float fixed z-50 flex flex-col outline-none transition-[translate,opacity] duration-300 ease-out',
            bottom
              ? 'inset-x-0 bottom-0 h-[92dvh] rounded-t-panel pb-[env(safe-area-inset-bottom)] data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full'
              : 'inset-y-3 right-3 w-[min(70vw,560px)] rounded-panel data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full',
            className,
          )}
        >
          <div
            className={cn('shrink-0 touch-none select-none', bottom ? 'cursor-grab' : '')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {bottom ? <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" /> : null}
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="m-0 truncate text-[17px] font-medium">{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description className="m-0 mt-1 text-[13px] text-ink-2">{description}</DialogPrimitive.Description> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {actions}
                <DialogPrimitive.Close render={<Button variant="icon" size="md" aria-label="Закрити" />}><X aria-hidden="true" strokeWidth={1.5} /></DialogPrimitive.Close>
              </div>
            </div>
          </div>
          {tabs ? <div className="shrink-0 border-b border-line px-5 pb-3">{tabs}</div> : <div className="shrink-0 border-b border-line" />}
          <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4"><div key={contentKey} className="tab-fade">{children}</div></div>
          {footer ? <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div> : null}
          <div ref={overlayRef} className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-[inherit] bg-solid empty:hidden" />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
