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
  const pendingCheckRef = useRef<DataSyncDetail['reason'] | null>(null);
  const lastRefreshAt = useRef(0);
  const businessDateRef = useRef(readKyivBusinessDate());

  const checkRevision = useCallback(async (reason: DataSyncDetail['reason']) => {
    if (checkingRef.current) {
      if (reason !== 'poll') pendingCheckRef.current = reason;
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

      // The page exposes the revision used for its server render. This catches a
      // write that lands between SSR and the first client poll instead of
      // incorrectly accepting the newer server value as a baseline.
      if (previous === null || revision === previous) {
        revisionRef.current = revision;
        return;
      }

      const now = Date.now();
      // Never consume a newer authoritative revision merely because a previous
      // refresh happened recently. Polls can retry it; explicit local/cross-tab
      // writes refresh immediately so derived workspaces cannot stay stale.
      if (reason === 'poll' && now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return;
      revisionRef.current = revision;
      lastRefreshAt.current = now;
      const detail: DataSyncDetail = { scope: 'all', reason, at: now };
      window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
      router.refresh();
    } catch {
      // Temporary sync failures are retried on the next poll/focus/online event.
    } finally {
      checkingRef.current = false;
      const pending = pendingCheckRef.current;
      pendingCheckRef.current = null;
      if (pending) window.setTimeout(() => void checkRevision(pending), 0);
    }
  }, [router]);

  const refreshBusinessDay = useCallback(() => {
    const nextDate = readKyivBusinessDate();
    if (nextDate === businessDateRef.current) return false;
    businessDateRef.current = nextDate;
    const now = Date.now();
    lastRefreshAt.current = now;
    const detail: DataSyncDetail = { scope: 'all', reason: 'poll', at: now };
    window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
    router.refresh();
    return true;
  }, [router]);

  useEffect(() => {
    if (!refreshBusinessDay()) void checkRevision('poll');

    const onFocus = () => { if (!refreshBusinessDay()) void checkRevision('focus'); };
    const onOnline = () => { if (!refreshBusinessDay()) void checkRevision('online'); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !refreshBusinessDay()) void checkRevision('focus');
    };
    const onLocalData = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      // A local workflow reconciles its own component immediately, then this
      // authoritative revision refresh updates Today/Reports/Analytics and all
      // other server-derived workspaces in the same tab.
      if (detail?.reason === 'local-write') void checkRevision('cross-tab');
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
      channel.onmessage = () => void checkRevision('cross-tab');
    }

    const timer = window.setInterval(() => {
      if (refreshBusinessDay()) return;
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
  }, [checkRevision, refreshBusinessDay]);

  return null;
}

function readRenderedRevision(): number | null {
  const raw = document.querySelector<HTMLElement>('[data-work-os-revision]')
    ?.dataset.workOsRevision;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}


function readKyivBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
