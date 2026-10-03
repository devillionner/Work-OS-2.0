'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  DATA_SYNC_CHANNEL,
  DATA_SYNC_EVENT,
  DATA_SYNC_REQUEST_EVENT,
  type DataSyncDetail,
  type DataSyncScope,
} from '@/lib/client-sync';

type SyncResponse = { revision?: number };
type SyncCheckResult = 'changed' | 'same' | 'skipped' | 'failed';

const SERVER_SYNC_ACTIVE_MS = 10_000;
const SERVER_SYNC_IDLE_MIN_MS = 30_000;
const SERVER_SYNC_IDLE_MAX_MS = 60_000;
const SERVER_SYNC_ERROR_MAX_MS = 300_000;
const MIN_REFRESH_GAP_MS = 1_200;
// A runner or a burst of local edits can announce several local-write/cross-tab signals within a few
// seconds; coalesce them into one authoritative check instead of one round trip per signal.
const WAKE_COALESCE_MS = 3_000;

// Different scopes merge up to 'all' instead of picking one arbitrarily, so a coalesced burst never
// under-reports what changed.
function mergeScope(current: DataSyncScope | null, next: DataSyncScope): DataSyncScope {
  if (current === null || current === next) return next;
  return 'all';
}

export function ServerSync() {
  const router = useRouter();
  const revisionRef = useRef<number | null>(null);
  const checkingRef = useRef(false);
  const pendingCheckRef = useRef<DataSyncDetail['reason'] | null>(null);
  const lastRefreshAt = useRef(0);
  const businessDateRef = useRef(readKyivBusinessDate());

  // oxlint-disable-next-line react/react-compiler -- TODO: потребує зміни логіки (docs/TODO.md)
  const checkRevision = useCallback(async (reason: DataSyncDetail['reason'], scope: DataSyncScope = 'all'): Promise<SyncCheckResult> => {
    if (checkingRef.current) {
      if (reason !== 'poll') pendingCheckRef.current = reason;
      return 'skipped';
    }
    if (typeof document === 'undefined') return 'skipped';
    if (document.visibilityState !== 'visible' && reason === 'poll') return 'skipped';
    if (document.querySelector('.app-update-backdrop')) return 'skipped';

    checkingRef.current = true;
    try {
      const response = await fetch(`/api/sync?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return 'failed';
      const result = await response.json() as SyncResponse;
      if (!Number.isSafeInteger(result.revision)) return 'failed';

      const revision = Number(result.revision);
      const renderedRevision = readRenderedRevision();
      if (
        renderedRevision !== null &&
        (revisionRef.current === null || renderedRevision > revisionRef.current)
      ) {
        revisionRef.current = renderedRevision;
      }
      const previous = revisionRef.current;

      if (previous === null || revision === previous) {
        revisionRef.current = revision;
        return 'same';
      }

      const now = Date.now();
      if (reason === 'poll' && now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return 'changed';

      revisionRef.current = revision;
      lastRefreshAt.current = now;
      const detail: DataSyncDetail = { scope, reason, at: now, revision };
      window.dispatchEvent(new CustomEvent<DataSyncDetail>(DATA_SYNC_EVENT, { detail }));
      router.refresh();
      return 'changed';
    } catch {
      return 'failed';
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
    let stopped = false;
    let pollTimer: number | null = null;
    let pollDelay = SERVER_SYNC_ACTIVE_MS;
    let failureDelay = 0;

    const schedulePoll = (delay: number) => {
      if (stopped) return;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => void poll(), delay);
    };

    const recordOutcome = (outcome: SyncCheckResult) => {
      if (outcome === 'changed') {
        pollDelay = SERVER_SYNC_ACTIVE_MS;
        failureDelay = 0;
        return;
      }
      if (outcome === 'same') {
        pollDelay = pollDelay <= SERVER_SYNC_ACTIVE_MS
          ? SERVER_SYNC_IDLE_MIN_MS
          : Math.min(SERVER_SYNC_IDLE_MAX_MS, pollDelay * 2);
        failureDelay = 0;
        return;
      }
      if (outcome === 'failed') {
        failureDelay = failureDelay === 0
          ? SERVER_SYNC_IDLE_MIN_MS
          : Math.min(SERVER_SYNC_ERROR_MAX_MS, failureDelay * 2);
        pollDelay = failureDelay;
        return;
      }
      pollDelay = Math.max(SERVER_SYNC_IDLE_MIN_MS, pollDelay);
    };

    async function poll() {
      if (stopped) return;
      if (refreshBusinessDay()) {
        pollDelay = SERVER_SYNC_ACTIVE_MS;
        failureDelay = 0;
        schedulePoll(pollDelay);
        return;
      }
      if (!navigator.onLine) {
        pollDelay = SERVER_SYNC_IDLE_MAX_MS;
        schedulePoll(pollDelay);
        return;
      }
      recordOutcome(await checkRevision('poll'));
      schedulePoll(pollDelay);
    }

    const wake = (reason: DataSyncDetail['reason'], scope: DataSyncScope = 'all') => {
      if (refreshBusinessDay()) {
        pollDelay = SERVER_SYNC_ACTIVE_MS;
        failureDelay = 0;
        schedulePoll(pollDelay);
        return;
      }
      void checkRevision(reason, scope).then((outcome) => {
        if (stopped) return;
        recordOutcome(outcome);
        if (outcome !== 'failed' && outcome !== 'skipped') {
          pollDelay = SERVER_SYNC_ACTIVE_MS;
          failureDelay = 0;
        }
        schedulePoll(pollDelay);
      });
    };

    let wakeTimer: number | null = null;
    let wakeScope: DataSyncScope | null = null;
    const scheduleWake = (reason: DataSyncDetail['reason'], scope: DataSyncScope) => {
      wakeScope = mergeScope(wakeScope, scope);
      if (wakeTimer !== null) window.clearTimeout(wakeTimer);
      wakeTimer = window.setTimeout(() => {
        wakeTimer = null;
        const merged = wakeScope ?? 'all';
        wakeScope = null;
        wake(reason, merged);
      }, WAKE_COALESCE_MS);
    };

    const onFocus = () => wake('focus');
    const onOnline = () => wake('online');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake('focus');
    };
    const onLocalData = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      if (detail?.reason === 'local-write') scheduleWake('cross-tab', detail.scope ?? 'all');
    };
    const onSyncRequest = (event: Event) => {
      const detail = (event as CustomEvent<DataSyncDetail>).detail;
      wake(detail?.reason === 'online' ? 'online' : 'focus');
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
      channel.onmessage = (event: MessageEvent<DataSyncDetail | undefined>) => scheduleWake('cross-tab', event.data?.scope ?? 'all');
    }

    schedulePoll(0);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener(DATA_SYNC_EVENT, onLocalData);
    window.addEventListener(DATA_SYNC_REQUEST_EVENT, onSyncRequest);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      if (wakeTimer !== null) window.clearTimeout(wakeTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(DATA_SYNC_EVENT, onLocalData);
      window.removeEventListener(DATA_SYNC_REQUEST_EVENT, onSyncRequest);
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
