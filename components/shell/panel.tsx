'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gsap, matchMotion } from '@/components/motion/gsap';
import { DESKTOP, PHONE, WIDE, useMediaQuery } from '@/components/shell/use-media';
import { Inspector } from '@/components/ui/inspector';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { useViewActive } from '@/components/shell/view-pane';

type Slot = { element: HTMLElement | null };
type PanelStack = { ids: string[] };

const SlotContext = createContext<Slot>({ element: null });
const OverlayContext = createContext<HTMLElement | null>(null);

/** Контейнер усередині панелі, куди вкладені форми малюються поверх вмісту (крок замість нового вікна). */
export function usePanelOverlay(): HTMLElement | null {
  return useContext(OverlayContext);
}

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
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const viewActive = useViewActive();

  useEffect(() => {
    if (!open || !viewActive) return;
    setStack([...stack.ids.filter((item) => item !== id), id]);
    return () => setStack(stack.ids.filter((item) => item !== id));
  }, [open, viewActive, id]);

  // Батьки передають onOpenChange замиканням, яке змінюється на кожному рендері. Тримаємо його в ref, щоб панель не
  // перемонтовувала ефекти (вхідну анімацію й фокус) щоразу, коли оновлюється розділ (секундний тік, live-подія).
  const latestOpenChange = useRef(onOpenChange);
  useEffect(() => { latestOpenChange.current = onOpenChange; });
  const handleOpenChange = useCallback((next: boolean) => latestOpenChange.current(next), []);
  const close = useCallback(() => latestOpenChange.current(false), []);
  const tabStrip = tabs && tab && onTabChange ? <Segmented value={tab} onValueChange={onTabChange} items={tabs} label={title} size="sm" /> : undefined;
  const body = <OverlayContext.Provider value={overlay}>{children}</OverlayContext.Provider>;

  if (!open || !isTop || !viewActive) return null;
  if (wide && slot.element) {
    return createPortal(
      <AsidePanel title={title} subtitle={subtitle} actions={actions} tabs={tabStrip} contentKey={tab} footer={footer} overlayRef={setOverlay} onClose={close}>{body}</AsidePanel>,
      slot.element,
    );
  }
  return (
    <Sheet
      open
      onOpenChange={handleOpenChange}
      title={title}
      description={subtitle}
      side={phone ? 'bottom' : 'right'}
      snap="full"
      actions={actions}
      tabs={tabStrip}
      contentKey={tab}
      footer={footer}
      overlayRef={setOverlay}
      className={!phone && desktop ? 'w-[440px]' : undefined}
    >
      {body}
    </Sheet>
  );
}

function AsidePanel({ title, subtitle, actions, tabs, contentKey, footer, overlayRef, onClose, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; tabs?: ReactNode; contentKey?: string; footer?: ReactNode; overlayRef: (element: HTMLDivElement | null) => void; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [returnTo] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));
  const latestClose = useRef(onClose);
  useEffect(() => { latestClose.current = onClose; });

  // Вхід — один раз при монтуванні й до першого кадру (layout-ефект), інакше повний вміст на мить блимає перед стартом анімації.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const mm = matchMotion((reduced) => {
      gsap.fromTo(node, reduced ? { opacity: 0 } : { x: 32, opacity: 0 }, { x: 0, opacity: 1, duration: reduced ? 0.12 : 0.28, clearProps: 'transform' });
    });
    return () => mm.revert();
  }, []);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Esc у відкритому списку чи меню закриває лише його, а не панель.
      if (event.target instanceof Element && event.target.closest('[role="listbox"], [role="menu"]')) return;
      event.preventDefault();
      latestClose.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
  }, [returnTo]);

  return (
    <aside ref={root} tabIndex={-1} aria-label={title} className="relative flex h-full min-h-0 flex-col outline-none">
      <Inspector title={title} subtitle={subtitle} actions={actions} tabs={tabs} contentKey={contentKey} onClose={onClose} className="min-h-0 flex-1">{children}</Inspector>
      {footer ? <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div> : null}
      <div ref={overlayRef} className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-solid empty:hidden" />
    </aside>
  );
}
