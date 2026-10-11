'use client';

import { useCallback, useSyncExternalStore } from 'react';

const EVENT = 'work-os:urlchange';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(EVENT, listener);
  };
}

/**
 * Параметр query як стан: `?lead=…` робить посилання й «назад/вперед» робочими без запитів до сервера
 * (history API напряму, без router.replace, який перезапустив би серверний рендер).
 */
export function useQueryParam(key: string): [string | null, (value: string | null, mode?: 'push' | 'replace') => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key),
    () => null,
  );
  const set = useCallback((next: string | null, mode: 'push' | 'replace' = 'push') => {
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete(key);
    else url.searchParams.set(key, next);
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (target === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (mode === 'push') window.history.pushState(window.history.state, '', target);
    else window.history.replaceState(window.history.state, '', target);
    window.dispatchEvent(new Event(EVENT));
  }, [key]);
  return [value, set];
}
