'use client';

import { useEffect, useRef } from 'react';

type Handler = (payload?: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
const pending = new Map<string, unknown>();

/**
 * Команда між шеллом і розділами («додати ліда», «додати чати»). Якщо розділ ще не змонтований (лінивий чанк),
 * команда чекає, доки з'явиться підписник.
 */
export function emitCommand(name: string, payload?: unknown) {
  const set = handlers.get(name);
  if (set?.size) set.forEach((handler) => handler(payload));
  else pending.set(name, payload ?? true);
}

export function useCommand(name: string, handler: Handler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const call: Handler = (payload) => ref.current(payload);
    let set = handlers.get(name);
    if (!set) { set = new Set(); handlers.set(name, set); }
    set.add(call);
    if (pending.has(name)) {
      const payload = pending.get(name);
      pending.delete(name);
      call(payload === true ? undefined : payload);
    }
    return () => { set.delete(call); };
  }, [name]);
}
