'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReveal } from '@/components/motion/use-reveal';

const ViewActiveContext = createContext(true);
const TopbarSlotContext = createContext<HTMLElement | null>(null);

export function TopbarSlotProvider({ element, children }: { element: HTMLElement | null; children: ReactNode }) {
  return <TopbarSlotContext.Provider value={element}>{children}</TopbarSlotContext.Provider>;
}

/** Контекстні контроли розділу в Topbar: рендеряться лише коли розділ активний. */
export function TopbarControls({ children }: { children: ReactNode }) {
  const active = useContext(ViewActiveContext);
  const slot = useContext(TopbarSlotContext);
  if (!active || !slot) return null;
  return createPortal(children, slot);
}

export function useViewActive(): boolean {
  return useContext(ViewActiveContext);
}

/**
 * Оболонка розділу: тримає змонтованим (стан і дані не губляться), ховає, коли розділ неактивний,
 * і запускає появу блоків `[data-reveal]` при кожній активації.
 */
export function ViewPane({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, active);

  useEffect(() => {
    if (active) return;
    ref.current?.querySelectorAll('[data-revealed]').forEach((node) => node.removeAttribute('data-revealed'));
  }, [active]);

  return (
    <ViewActiveContext.Provider value={active}>
      <div ref={ref} data-pane="" data-active={active ? 'true' : 'false'} hidden={!active} aria-hidden={active ? undefined : true} inert={active ? undefined : true} className="min-w-0">
        {children}
      </div>
    </ViewActiveContext.Provider>
  );
}
