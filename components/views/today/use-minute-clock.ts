'use client';

import { useEffect, useState } from 'react';
import { nowSeconds } from '@/components/views/today/clock';

/** Поточний час у секундах: оновлюється на початку кожної хвилини локально, без мережі. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const wait = 60_500 - (nowSeconds() % 60) * 1000;
      timer = window.setTimeout(() => { setNow(nowSeconds()); schedule(); }, wait);
    };
    schedule();
    // Після сну вкладки таймер міг відстати: перераховуємо одразу, щойно вкладка знову видима.
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(nowSeconds()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return now;
}
