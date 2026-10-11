'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gsap, matchMotion } from '@/components/motion/gsap';
import { DESKTOP, PHONE, WIDE, useMediaQuery } from '@/components/shell/use-media';
import { Inspector } from '@/components/ui/inspector';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';

type Slot = { element: HTMLElement | null };
type PanelStack = { ids: string[] };

const SlotContext = createContext<Slot>({ element: null });

// Стек відкритих панелей: видима лише остання, попередні повертаються, коли верхня закривається.
const stackListeners = new Set<() => void>();
let stack: PanelStack = { ids: [] };

function setStack(next: string[]) {
  stack = { ids: next };
  stackListeners.forEach((listener) => listener());
}
function useStack(): PanelStack {
  return useSyncExternalStore(
    (listener) => { stackListeners.add(listener); return () => { stackListeners.delete(listener); }; },
    () => stack,
    () => stack,
  );
}

/** Скільки панелей відкрито: AppFrame резервує місце під Inspector на широких екранах. */
export function useOpenPanelCount(): number {
  return useStack().ids.length;
}

export function PanelSlotProvider({ element, children }: { element: HTMLElement | null; children: ReactNode }) {
  const value = useMemo(() => ({ element }), [element]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

export type PanelTab<T extends string = string> = { value: T; label: ReactNode };

type PanelProps<T extends string> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReadonlyArray<PanelTab<T>>;
  tab?: T;
  onTabChange?: (tab: T) => void;
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Деталі сутності: Inspector праворуч на широких екранах (зсуває контент), Sheet праворуч на планшеті
 * і вузькому десктопі, Sheet знизу на телефоні. Стан лишається у розділі, що відкрив панель.
 */
export function Panel<T extends string = string>({ open, onOpenChange, title, subtitle, actions, tabs, tab, onTabChange, footer, children }: PanelProps<T>) {
  const id = useId();
  const slot = useContext(SlotContext);
  const wide = useMediaQuery(WIDE);
  const phone = useMediaQuery(PHONE);
  const desktop = useMediaQuery(DESKTOP);
  const { ids } = useStack();
  const isTop = ids[ids.length - 1] === id;

  useEffect(() => {
    if (!open) return;
    setStack([...stack.ids.filter((item) => item !== id), id]);
    return () => setStack(stack.ids.filter((item) => item !== id));
  }, [open, id]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const body = (
    <>
      {tabs && tab && onTabChange ? (
        <div className="sticky top-0 z-10 -mx-1 mb-4 overflow-x-auto px-1 pb-1 hide-scrollbar">
          <Segmented value={tab} onValueChange={onTabChange} items={tabs} label={title} size="sm" />
        </div>
      ) : null}
      {children}
    </>
  );

  if (!open || !isTop) return null;
  if (wide && slot.element) {
    return createPortal(
      <AsidePanel title={title} subtitle={subtitle} actions={actions} footer={footer} onClose={close}>{body}</AsidePanel>,
      slot.element,
    );
  }
  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={title}
      description={subtitle}
      side={phone ? 'bottom' : 'right'}
      snap="full"
      actions={actions}
      footer={footer}
      className={!phone && desktop ? 'w-[440px]' : undefined}
    >
      {body}
    </Sheet>
  );
}

function AsidePanel({ title, subtitle, actions, footer, onClose, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; footer?: ReactNode; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [returnTo] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const mm = matchMotion((reduced) => {
      gsap.fromTo(node, reduced ? { opacity: 0 } : { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: reduced ? 0.12 : 0.42, clearProps: 'transform' });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      mm.revert();
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
  }, [onClose, returnTo]);

  return (
    <aside ref={root} tabIndex={-1} aria-label={title} className="flex h-full min-h-0 flex-col outline-none">
      <Inspector title={title} subtitle={subtitle} actions={actions} onClose={onClose} className="min-h-0 flex-1">{children}</Inspector>
      {footer ? <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div> : null}
    </aside>
  );
}
