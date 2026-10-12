'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gsap, matchMotion } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

export type ToastInput = {
  message: string;
  /** Для оборотних дій: кнопка зліва від тексту, наприклад «Скасувати». */
  action?: { label: string; onClick: () => void };
  tone?: 'neutral' | 'ok' | 'hot';
  /** За замовчуванням 4000 мс. */
  duration?: number;
};

type ToastItemData = ToastInput & { id: number };
type ToastApi = { push: (toast: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItemData[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback((toast: ToastInput) => {
    const id = ++counter;
    setItems((current) => [...current.slice(-2), { ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <output aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4" style={{ bottom: 'calc(var(--toast-bottom) + env(safe-area-inset-bottom))' }}>
        {items.map((item) => <ToastItem key={item.id} item={item} onDone={dismiss} />)}
      </output>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onDone }: { item: ToastItemData; onDone: (id: number) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    const element = node.current;
    if (closing.current || !element) return;
    closing.current = true;
    const mm = matchMotion((reduced) => {
      gsap.to(element, { y: reduced ? 0 : 12, opacity: 0, duration: reduced ? 0.01 : 0.2, ease: 'power3.in', onComplete: () => onDone(item.id) });
    });
    // Якщо кадри не малюються (вкладка у фоні), твін не завершиться, тож прибираємо Toast і за таймером.
    window.setTimeout(() => { mm.revert(); onDone(item.id); }, 400);
  }, [item.id, onDone]);

  useEffect(() => {
    const element = node.current;
    if (!element) return;
    const mm = matchMotion((reduced) => {
      gsap.fromTo(element, reduced ? { opacity: 0 } : { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: reduced ? 0.12 : 0.24 });
    });
    const timer = window.setTimeout(close, item.duration ?? 4000);
    return () => { window.clearTimeout(timer); mm.revert(); };
  }, [close, item.duration]);

  return (
    <div ref={node} className="glass-strong frost shadow-float pointer-events-auto inline-flex max-w-[min(520px,100%)] items-center gap-3 rounded-full py-2 pl-5 pr-2 text-sm">
      <span className={cn('min-w-0 flex-1', item.tone === 'hot' && 'text-hot', item.tone === 'ok' && 'text-ok')}>{item.message}</span>
      {item.action ? (
        <button type="button" onClick={() => { item.action?.onClick(); close(); }} className="h-8 shrink-0 rounded-full bg-action px-4 text-[13px] font-medium text-action-ink active:scale-[0.985]">{item.action.label}</button>
      ) : null}
    </div>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast має використовуватись усередині ToastProvider.');
  return context;
}
