'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { humanError } from '@/components/ui/human-error';

export type TelegramAccount = { id: string; number: number; name: string; enabled: boolean; selected: boolean; joinStreak: number; joinBatchSize: number; breakMinutes: number; breakUntil: number | null };
type State = { accounts: TelegramAccount[]; loaded: boolean; error: string; busy: boolean };

const listeners = new Set<() => void>();
let state: State = { accounts: [], loaded: false, error: '', busy: false };
let inflight: Promise<void> | null = null;

function emit(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function loadTelegramAccounts(force = false): Promise<void> {
  if (inflight) return inflight;
  if (state.loaded && !force) return Promise.resolve();
  inflight = (async () => {
    try {
      const response = await fetch('/api/telegram-accounts', { cache: 'no-store' });
      const body = await response.json() as { accounts?: TelegramAccount[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося завантажити Telegram-акаунти.');
      emit({ accounts: body.accounts || [], loaded: true, error: '' });
    } catch (reason) {
      emit({ loaded: true, error: humanError(reason, 'Не вдалося завантажити Telegram-акаунти.') });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Обраний робочий акаунт: позначений сервером і ввімкнений, інакше перший ввімкнений. */
export function pickAccountId(accounts: readonly TelegramAccount[]): string | null {
  return (accounts.find((item) => item.selected && item.enabled) ?? accounts.find((item) => item.enabled))?.id ?? null;
}

export async function telegramAccountAction(action: string, id?: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  emit({ busy: true, error: '' });
  try {
    const response = await fetch('/api/telegram-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, ...extra }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || 'Не вдалося оновити акаунт.');
    emit({ busy: false });
    await loadTelegramAccounts(true);
    return true;
  } catch (reason) {
    emit({ busy: false, error: humanError(reason, 'Не вдалося оновити акаунт.') });
    return false;
  }
}

export function useTelegramAccounts(enabled = true) {
  const snapshot = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => state,
  );
  useEffect(() => { if (enabled) void loadTelegramAccounts(); }, [enabled]);
  return { ...snapshot, accountId: pickAccountId(snapshot.accounts) };
}
