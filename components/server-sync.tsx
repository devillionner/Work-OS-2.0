'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  DATA_SYNC_CHANNEL,
  DATA_SYNC_EVENT,
  type DataSyncDetail,
} from '@/lib/client-sync';

const SERVER_SYNC_MS = 10_000;
const MIN_REFRESH_GAP_MS = 1_200;

export function ServerSync() {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  const refresh = useCallback((reason: DataSyncDetail['reason']) => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible' && reason === 'poll') return;
    if (document.querySelector('.app-update-backdrop')) return;
    const now = Date.now();
    if (now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return;
    lastRefreshAt.current = now;
    const detail: DataSyncDetail = { scope: 'all', reason, at: now };
    window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
    router.refresh();
  }, [router]);

  useEffect(() => {
    const onFocus = () => refresh('focus');
    const onOnline = () => refresh('online');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh('focus');
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
      channel.onmessage = () => refresh('cross-tab');
    }

    const timer = window.setInterval(() => {
      if (navigator.onLine) refresh('poll');
    }, SERVER_SYNC_MS);

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
    };
  }, [refresh]);

  return null;
}
