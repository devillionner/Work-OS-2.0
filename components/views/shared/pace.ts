import { ratioPercent, type RingTone } from '@/components/ui/ring';

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

/** Відсоток цілі для підпису біля кільця: до виконання — floor (139/140 → 99), після — фактичний (≥ 100). */
export function goalPercent(completed: number, target: number): number {
  return ratioPercent(goalRatio(completed, target));
}

/**
 * Єдиний тон кільця цілі для «Сьогодні» і «Платформ»: виконано — ok; до старту дня — нейтральне;
 * у темпі (≥ 85 % від того, що мало б бути до цього часу) — біле; трохи відстає (≥ 60 %) — warn; сильно відстає — hot.
 * `now` — unix-секунди, `started` — чи день розпочато.
 */
export function goalTone(completed: number, target: number, started: boolean, now: number): RingTone {
  if (target <= 0) return 'ink';
  const ratio = goalRatio(completed, target);
  if (ratio >= 1) return 'ok';
  if (!started) return 'ink';
  const expected = Math.max(0.02, dayProgress(new Date(now * 1000)));
  return ratio >= expected * 0.85 ? 'ink' : ratio >= expected * 0.6 ? 'warn' : 'hot';
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
