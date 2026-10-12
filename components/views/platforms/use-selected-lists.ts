'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { humanError } from '@/components/ui/human-error';
import type { SelectedChatsView, SelectedListInfo } from '@/lib/chats/telegram-selected';

const LIST_KEY = 'work-os:selected-list';
const RELOAD_AFTER_MS = 5 * 60_000;

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/chats/telegram-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || 'Не вдалося виконати дію зі списком.');
  return value;
}

function readStoredListId(): string | null {
  try { return window.localStorage.getItem(LIST_KEY); } catch { return null; }
}

/**
 * Іменовані списки «Відібрані» для Telegram: метадані списків читаються один раз при відкритті платформи (1 рядок налаштувань),
 * вміст списку — лише коли його відкрито, і тримається в пам'яті сеансу не довше 5 хвилин.
 */
export function useSelectedLists({ enabled, viewing }: { enabled: boolean; viewing: boolean }) {
  const [lists, setLists] = useState<SelectedListInfo[] | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(() => (typeof window === 'undefined' ? null : readStoredListId()));
  const [views, setViews] = useState<Record<string, SelectedChatsView>>({});
  const [failed, setFailed] = useState(false);
  const loadedAt = useRef<Record<string, number>>({});

  const listId = lists ? (lists.some((item) => item.id === requestedId) ? requestedId : lists[0]?.id ?? null) : null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/chats/telegram-selected?summary=1', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() as Promise<{ lists?: SelectedListInfo[] }> : null))
      .then((body) => { if (!cancelled && Array.isArray(body?.lists)) setLists(body.lists); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);

  const current = listId ? views[listId] ?? null : null;
  const viewsRef = useRef(views);
  useEffect(() => { viewsRef.current = views; });
  useEffect(() => {
    if (!enabled || !viewing || !listId) return;
    if (viewsRef.current[listId] && Date.now() - (loadedAt.current[listId] ?? 0) < RELOAD_AFTER_MS) return;
    let cancelled = false;
    fetch(`/api/chats/telegram-selected?list=${encodeURIComponent(listId)}`, { cache: 'no-store' })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) as SelectedChatsView | null }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok && body && Array.isArray(body.items)) {
          loadedAt.current[listId] = Date.now();
          setViews((all) => ({ ...all, [listId]: body }));
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enabled, viewing, listId]);

  const select = useCallback((id: string) => {
    setRequestedId(id);
    try { window.localStorage.setItem(LIST_KEY, id); } catch { /* сховище недоступне */ }
  }, []);

  const setView = useCallback((updater: (view: SelectedChatsView) => SelectedChatsView) => {
    if (!listId) return;
    setViews((all) => (all[listId] ? { ...all, [listId]: updater(all[listId]) } : all));
  }, [listId]);

  const replaceView = useCallback((view: SelectedChatsView) => {
    if (!listId) return;
    loadedAt.current[listId] = Date.now();
    setViews((all) => ({ ...all, [listId]: view }));
  }, [listId]);

  const create = useCallback(async (): Promise<string> => {
    try {
      const body = await post<{ lists: SelectedListInfo[] }>({ action: 'create-list' });
      setLists(body.lists);
      const created = body.lists[body.lists.length - 1];
      if (created) select(created.id);
      return '';
    } catch (reason) { return humanError(reason, 'Не вдалося створити список.'); }
  }, [select]);

  const rename = useCallback(async (id: string, name: string): Promise<string> => {
    try {
      const body = await post<{ lists: SelectedListInfo[] }>({ action: 'rename-list', listId: id, name });
      setLists(body.lists);
      return '';
    } catch (reason) { return humanError(reason, 'Не вдалося перейменувати список.'); }
  }, []);

  const remove = useCallback(async (id: string): Promise<string> => {
    try {
      const body = await post<{ lists: SelectedListInfo[] }>({ action: 'delete-list', listId: id });
      setLists(body.lists);
      setViews((all) => { const { [id]: _removed, ...rest } = all; return rest; });
      if (requestedId === id && body.lists[0]) select(body.lists[0].id);
      return '';
    } catch (reason) { return humanError(reason, 'Не вдалося видалити список.'); }
  }, [requestedId, select]);

  // Лічильник списку: уточнений довжиною завантаженого вмісту.
  const items = useMemo(() => (lists ?? []).map((item) => ({ ...item, count: views[item.id]?.items.length ?? item.count })), [lists, views]);

  return { lists: items, listId, view: current, failed, select, create, rename, remove, setView, replaceView };
}
