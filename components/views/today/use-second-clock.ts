'use client';

import { useSyncExternalStore } from 'react';
import { nowSeconds } from '@/components/views/today/clock';

const subscribe = (listener: () => void) => {
  const timer = window.setInterval(listener, 1000);
  return () => window.clearInterval(timer);
};
const idle = () => () => undefined;

/** Поточний час у секундах, що тікає щосекунди лише поки `enabled`: для таймера активного часу. */
export function useSecondClock(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribe : idle, nowSeconds, nowSeconds);
}
