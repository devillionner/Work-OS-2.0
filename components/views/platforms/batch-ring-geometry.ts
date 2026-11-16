export type RingSegment = 'sent' | 'failed' | 'busy';
export type RingAngles = Record<RingSegment, { start: number; sweep: number }>;

/**
 * Кути сегментів кільця (градуси від 12 годин за годинниковою стрілкою): відправлені, далі не вдалося, далі в роботі; кожен починається
 * там, де скінчився попередній. Ненульова частка має мінімальну дугу довжиною в товщину треку (округла «крапка-риска», а не брусок),
 * нуль — 0 (шар не малюється). Сума не перевищує 360°.
 */
export function ringAngles({ total, sent, failed, busy, stroke, radius }: { total: number; sent: number; failed: number; busy: number; stroke: number; radius: number }): RingAngles {
  const safe = Math.max(1, total);
  const minimum = (stroke / radius) * (180 / Math.PI);
  const sweep = (count: number) => (count > 0 ? Math.max(minimum, Math.min(360, (count / safe) * 360)) : 0);
  const sentSweep = Math.min(sweep(sent), 360);
  const failedSweep = Math.min(sweep(failed), 360 - sentSweep);
  const busySweep = Math.min(sweep(busy), 360 - sentSweep - failedSweep);
  return {
    sent: { start: 0, sweep: sentSweep },
    failed: { start: sentSweep, sweep: failedSweep },
    busy: { start: sentSweep + failedSweep, sweep: busySweep },
  };
}
