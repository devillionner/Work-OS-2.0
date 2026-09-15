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
  const pendingLocalAckRef = useRef(false);
  const lastRefreshAt = useRef(0);

  const checkRevision = useCallback(async (
    reason: DataSyncDetail['reason'],
    acknowledgeOnly = false,
  ) => {
    if (checkingRef.current) {
      if (acknowledgeOnly) pendingLocalAckRef.current = true;
      return;
    }
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
      const renderedRevision = readRenderedRevision();
      if (
        renderedRevision !== null &&
        (revisionRef.current === null || renderedRevision > revisionRef.current)
      ) {
        revisionRef.current = renderedRevision;
      }
      const previous = revisionRef.current;
      const localAck = acknowledgeOnly || pendingLocalAckRef.current;
      pendingLocalAckRef.current = false;
      revisionRef.current = revision;

      // The page exposes the revision used for its server render. This catches a
      // write that lands between SSR and the first client poll instead of
      // incorrectly accepting the newer server value as a baseline. It also
      // prevents a second refresh when a local workflow already refreshed RSC.
      if (previous === null) return;
      if (localAck || revision === previous) return;

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

function readRenderedRevision(): number | null {
  const raw = document.querySelector<HTMLElement>('[data-work-os-revision]')
    ?.dataset.workOsRevision;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
