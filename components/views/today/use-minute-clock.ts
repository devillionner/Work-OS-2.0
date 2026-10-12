'use client';

import { useEffect, useState } from 'react';

/** Поточний час у секундах, що оновлюється раз на хвилину локально (без мережі). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
