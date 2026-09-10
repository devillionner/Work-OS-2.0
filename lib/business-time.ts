import { businessDate, lessonEpoch } from './leads/domain/time.ts';

export { businessDate };

export function shiftBusinessDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function businessDayStart(date: string): number {
  // Reuse the timezone database resolver; the offset at noon can differ from
  // the offset at midnight on DST days. Never assume a day lasts 86400 seconds.
  const epoch = lessonEpoch(date, '00:00');
  if (epoch === null) throw new Error('Не вдалося визначити початок робочого дня.');
  return epoch;
}

export function snoozeDeadline(now: number): number {
  return businessDayStart(shiftBusinessDate(businessDate(now), 3));
}
