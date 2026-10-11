'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { announceDataChange, DATA_SYNC_EVENT, type DataSyncDetail } from '@/lib/client-sync';

export type ScheduleSettings = { intervalMinutes: number; baseAt: number; selectionMode: 'auto' | 'manual'; manualChatIds: string[]; version: number };
export type ScheduleChat = { id: string; name: string; link: string };
export type ScheduleSlot = {
  id: string; sequence: number; scheduledAt: number; chatId: string | null; chatName: string | null; chatLink: string | null;
  chatStateToken: string | null; status: 'pending' | 'completed'; completedAt: number | null; version: number;
};
export type ScheduleSnapshot = { accountId: string; settings: ScheduleSettings; eligibleChats: ScheduleChat[]; slots: ScheduleSlot[]; pending: number; completed: number; nextSlot: ScheduleSlot | null };
type Entry = { snapshot: ScheduleSnapshot | null; loading: boolean; error: string; busy: boolean };

const EMPTY: Entry = { snapshot: null, loading: false, error: '', busy: false };
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function read(accountId: string): Entry { return entries.get(accountId) ?? EMPTY; }
function write(accountId: string, patch: Partial<Entry>) {
  entries.set(accountId, { ...read(accountId), ...patch });
  listeners.forEach((listener) => listener());
}

export function loadSchedule(accountId: string, force = false): Promise<void> {
  const running = inflight.get(accountId);
  if (running) return running;
  if (read(accountId).snapshot && !force) return Promise.resolve();
  write(accountId, { loading: true, error: '' });
  const promise = (async () => {
    try {
      const response = await fetch(`/api/telegram-schedule?${new URLSearchParams({ account: accountId })}`, { cache: 'no-store' });
      const body = await response.json() as ScheduleSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити розклад.');
      write(accountId, { snapshot: body, loading: false });
    } catch (reason) {
      write(accountId, { loading: false, error: reason instanceof Error ? reason.message : 'Не вдалося завантажити розклад.' });
    } finally {
      inflight.delete(accountId);
    }
  })();
  inflight.set(accountId, promise);
  return promise;
}

async function request(accountId: string, body: Record<string, unknown>, failure: string): Promise<ScheduleSnapshot | null> {
  write(accountId, { busy: true, error: '' });
  try {
    const response = await fetch('/api/telegram-schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, ...body }) });
    const next = await response.json() as ScheduleSnapshot & { error?: string };
    if (!response.ok) throw new Error(next.error || failure);
    write(accountId, { snapshot: next, busy: false });
    announceDataChange('platforms');
    return next;
  } catch (reason) {
    write(accountId, { busy: false, error: reason instanceof Error ? reason.message : failure });
    return null;
  }
}

export const telegramSchedule = {
  save: (accountId: string, payload: { expectedVersion: number; intervalMinutes: number; baseAt: number; selectionMode: 'auto' | 'manual'; manualChatIds: string[] }) =>
    request(accountId, { action: 'save', ...payload }, 'Не вдалося оновити розклад.'),
  generate: (accountId: string, count: number) => request(accountId, { action: 'generate', count }, 'Не вдалося оновити розклад.'),
  clearPending: (accountId: string) => request(accountId, { action: 'clear_pending' }, 'Не вдалося оновити розклад.'),
  archiveSlot: (accountId: string, slot: ScheduleSlot, reason: string) =>
    request(accountId, { action: 'archive_slot', slotId: slot.id, reason, stateToken: slot.chatStateToken }, 'Не вдалося перенести чат в архів.'),
  unlinkSlot: (accountId: string, slot: ScheduleSlot) => request(accountId, { action: 'unlink_slot', slotId: slot.id }, 'Не вдалося відв’язати чат від слота.'),
  editSlot: (accountId: string, slot: ScheduleSlot, change: { scheduledAt?: number; chatId?: string | null }) =>
    request(accountId, { action: 'slot', slotId: slot.id, expectedVersion: slot.version, ...(change.scheduledAt !== undefined ? { scheduledAt: change.scheduledAt } : {}), ...(change.chatId !== undefined ? { chatId: change.chatId } : {}) }, 'Не вдалося оновити розклад.'),
  async markPublished(accountId: string, slot: ScheduleSlot): Promise<boolean> {
    if (!slot.chatId || !slot.chatStateToken) return false;
    write(accountId, { busy: true, error: '' });
    try {
      const response = await fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: slot.chatId, action: 'published', stateToken: slot.chatStateToken, accountId }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося відмітити публікацію.');
      write(accountId, { busy: false });
      announceDataChange('platforms');
      await loadSchedule(accountId, true);
      return true;
    } catch (reason) {
      write(accountId, { busy: false, error: reason instanceof Error ? reason.message : 'Не вдалося відмітити публікацію.' });
      return false;
    }
  },
};

export function useTelegramSchedule(accountId: string | null) {
  const entry = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => (accountId ? read(accountId) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => { if (accountId) void loadSchedule(accountId); }, [accountId]);
  // Зміни з іншого пристрою чи вкладки (не наші власні записи) перечитують розклад один раз.
  useEffect(() => {
    if (!accountId) return;
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      if (!detail || detail.reason === 'local-write') return;
      if (detail.scope === 'platforms' || detail.scope === 'all') void loadSchedule(accountId, true);
    };
    window.addEventListener(DATA_SYNC_EVENT, onSync);
    return () => window.removeEventListener(DATA_SYNC_EVENT, onSync);
  }, [accountId]);
  return entry;
}
