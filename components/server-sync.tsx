'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  DATA_SYNC_CHANNEL,
  DATA_SYNC_EVENT,
  type DataSyncDetail,
} from '@/lib/client-sync';

type SyncResponse = { revision?: number };

const SERVER_SYNC_MS = 10_000;
const MIN_REFRESH_GAP_MS = 1_200;

export function ServerSync() {
  const router = useRouter();
  const revisionRef = useRef<number | null>(null);
  const checkingRef = useRef(false);
  const lastRefreshAt = useRef(0);

  const checkRevision = useCallback(async (
    reason: DataSyncDetail['reason'],
    acknowledgeOnly = false,
  ) => {
    if (checkingRef.current) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible' && reason === 'poll') return;
    if (document.querySelector('.app-update-backdrop')) return;

    checkingRef.current = true;
    try {
      const response = await fetch(`/api/sync?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const result = await response.json() as SyncResponse;
      if (!Number.isSafeInteger(result.revision)) return;
      const revision = Number(result.revision);
      const previous = revisionRef.current;
      revisionRef.current = revision;

      // The first read establishes a baseline. A successful local write is
      // already reflected optimistically in this tab, so only acknowledge its
      // new revision here; sibling tabs/devices still refresh independently.
      if (previous === null || acknowledgeOnly || revision === previous) return;

      const now = Date.now();
      if (now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return;
      lastRefreshAt.current = now;
      const detail: DataSyncDetail = { scope: 'all', reason, at: now };
      window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
      router.refresh();
    } catch {
      // Temporary sync failures are retried on the next poll/focus/online event.
    } finally {
      checkingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    void checkRevision('poll');

    const onFocus = () => void checkRevision('focus');
    const onOnline = () => void checkRevision('online');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRevision('focus');
    };
    const onLocalData = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      if (detail?.reason === 'local-write') void checkRevision('local-write', true);
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
      channel.onmessage = () => void checkRevision('cross-tab');
    }

    const timer = window.setInterval(() => {
      if (navigator.onLine) void checkRevision('poll');
    }, SERVER_SYNC_MS);

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener(DATA_SYNC_EVENT, onLocalData);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(DATA_SYNC_EVENT, onLocalData);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
    };
  }, [checkRevision]);

  return null;
}
