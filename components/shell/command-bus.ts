'use client';

import { useEffect, useRef, useState } from 'react';
import { useViewActive } from '@/components/shell/view-pane';

type Handler = (payload?: unknown) => void;

const wakers = new Map<string, Set<() => void>>();
const pending = new Map<string, { payload: unknown }>();

/**
 * Команда між шеллом і розділами («додати ліда», «відкрити автопост Viber»). Команда лягає в слот очікування
 * (остання перемагає) і доставляється один раз, коли підписник змонтований і його розділ активний.
 */
export function emitCommand(name: string, payload?: unknown) {
  pending.set(name, { payload });
  wakers.get(name)?.forEach((wake) => wake());
}

/**
 * Доставка йде не одразу, а на наступному рендері підписника: розділ, що щойно з'явився чи став активним,
 * у своїх ефектах відновлює збережений стан (платформу, чергу) мікрозадачами. Якби команда виконалась раніше,
 * це відновлення перекрило б її, а обробник бачив би стан до відновлення.
 */
export function useCommand(name: string, handler: Handler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  const active = useViewActive();
  const [tick, setTick] = useState(0);
  const armedAt = useRef<number | null>(null);

  useEffect(() => {
    const wake = () => setTick((value) => value + 1);
    let set = wakers.get(name);
    if (!set) { set = new Set(); wakers.set(name, set); }
    set.add(wake);
    return () => { set.delete(wake); };
  }, [name]);

  useEffect(() => {
    const entry = pending.get(name);
    if (!active || !entry) { armedAt.current = null; return; }
    if (armedAt.current === null || armedAt.current >= tick) {
      armedAt.current = tick;
      queueMicrotask(() => setTick((value) => value + 1));
      return;
    }
    armedAt.current = null;
    pending.delete(name);
    ref.current(entry.payload);
  }, [name, active, tick]);
}
