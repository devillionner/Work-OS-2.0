'use client';

import { useSyncExternalStore } from 'react';
import { subscribeLiveStatus, type LiveStatus } from '@/lib/live-channel';

const SERVER: LiveStatus = { connected: false, runnerConnected: null };
const subscribers = new Set<() => void>();
let latest: LiveStatus = SERVER;
let upstream: (() => void) | null = null;

function subscribe(listener: () => void) {
  subscribers.add(listener);
  if (!upstream) {
    upstream = subscribeLiveStatus((status) => {
      latest = status;
      subscribers.forEach((callback) => callback());
    });
  }
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size && upstream) { upstream(); upstream = null; }
  };
}

/** Стан live-каналу (Durable Object) як зовнішній стор. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribe, () => latest, () => SERVER);
}
