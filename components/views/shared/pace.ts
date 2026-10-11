import { goalTone, type RingTone } from '@/components/ui/ring';

const DAY_START_HOUR = 9;
const DAY_END_HOUR = 21;

/** Частка робочого вікна 09:00–21:00 за Києвом, що вже минула: «у темпі» для кілець цілей. */
export function dayProgress(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Kyiv' }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const elapsed = (hour + minute / 60 - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR);
  return Math.max(0, Math.min(1, elapsed));
}

export function goalRatio(completed: number, target: number): number {
  return target > 0 ? completed / target : 0;
}

export function toneFor(completed: number, target: number): RingTone {
  return target > 0 ? goalTone(goalRatio(completed, target), dayProgress()) : 'ink';
}

export function greeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Kyiv' }).format(date));
  if (hour >= 5 && hour < 12) return 'Доброго ранку';
  if (hour >= 12 && hour < 18) return 'Добрий день';
  if (hour >= 18 && hour < 23) return 'Добрий вечір';
  return 'Доброї ночі';
}

export function dateLabel(date = new Date()): string {
  const value = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}
