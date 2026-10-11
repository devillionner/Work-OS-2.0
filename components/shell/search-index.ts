'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type SearchItem = { id: string; group: string; label: string; hint?: string; run: () => void };

const sources = new Map<string, readonly SearchItem[]>();
const listeners = new Set<() => void>();
let snapshot: readonly SearchItem[] = [];

function rebuild() {
  snapshot = Array.from(sources.values()).flat();
  listeners.forEach((listener) => listener());
}

/** Розділи реєструють уже завантажені на клієнті сутності; жодного нового серверного пошуку. */
export function useSearchIndex(source: string, items: readonly SearchItem[]) {
  useEffect(() => {
    sources.set(source, items);
    rebuild();
    return () => { sources.delete(source); rebuild(); };
  }, [source, items]);
}

export function useSearchItems(): readonly SearchItem[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot,
    () => snapshot,
  );
}
