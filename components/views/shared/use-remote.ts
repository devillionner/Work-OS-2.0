'use client';

import { useEffect, useRef, useState } from 'react';
import { humanError } from '@/components/ui/human-error';

type Entry<T> = { data: T; refresh: number };
type Failure = { message: string; refresh: number };

export type Remote<T> = { data: T | null; error: string; loading: boolean; /** Дані від попереднього адреса (лише з keepPrevious), поки новий ще вантажиться. */ stale: boolean };

/**
 * GET JSON з кешем по адресі: той самий адрес не перечитується, доки не змінився `refresh`.
 * Поки йде оновлення, лишаються попередні дані (`loading` = true), тож блоки не блимають.
 */
export function useRemote<T>(url: string | null, { refresh = 0, enabled = true, keepPrevious = false, fallback = 'Не вдалося завантажити дані.' }: { refresh?: number; enabled?: boolean; keepPrevious?: boolean; fallback?: string } = {}): Remote<T> {
  const [entries, setEntries] = useState<Record<string, Entry<T>>>({});
  const [last, setLast] = useState<T | null>(null);
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const loaded = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !url || loaded.current.get(url) === refresh) return;
    const controller = new AbortController();
    void fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as T & { error?: string };
        if (!response.ok) throw new Error(body.error || fallback);
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        loaded.current.set(url, refresh);
        setEntries((current) => ({ ...current, [url]: { data: body, refresh } }));
        setLast(body);
        setFailures((current) => {
          if (!current[url]) return current;
          const { [url]: _removed, ...rest } = current;
          return rest;
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setFailures((current) => ({ ...current, [url]: { message: humanError(reason, fallback), refresh } }));
      });
    return () => controller.abort();
  }, [url, refresh, enabled, fallback]);

  const entry = url ? entries[url] : undefined;
  const failure = url ? failures[url] : undefined;
  const failed = failure !== undefined && failure.refresh === refresh;
  const stale = keepPrevious && entry === undefined && last !== null;
  return {
    data: entry?.data ?? (keepPrevious ? last : null),
    error: failed ? failure.message : '',
    loading: Boolean(enabled && url && !failed && (!entry || entry.refresh !== refresh)),
    stale,
  };
}
