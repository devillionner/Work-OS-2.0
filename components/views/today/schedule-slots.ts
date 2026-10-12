import type { ScheduleSlot } from '@/components/views/platforms/telegram-schedule-store';
import { businessDateTime } from '@/lib/leads/domain/time';

/** Слот із чатом вважається пропущеним, якщо його час минув більш ніж на 5 хвилин, а публікацію не відмічено. */
export const MISSED_AFTER_SECONDS = 5 * 60;

export const slotTime = (epoch: number) => businessDateTime(epoch).slice(11, 16);

export const isMissed = (slot: ScheduleSlot, now: number) => slot.status === 'pending' && slot.chatId !== null && now - slot.scheduledAt > MISSED_AFTER_SECONDS;

/** Перший слот із чатом, час якого ще не минув (або минув не більш ніж на 5 хвилин). */
export const nextPending = (slots: readonly ScheduleSlot[], now: number) => slots.find((slot) => slot.status === 'pending' && slot.chatId !== null && !isMissed(slot, now)) ?? null;

/** «через 25 хв», «через 1 год 10 хв», «зараз». */
export function inMinutes(slot: ScheduleSlot, now: number): string {
  const minutes = Math.round((slot.scheduledAt - now) / 60);
  if (minutes <= 0) return 'зараз';
  if (minutes < 60) return `через ${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `через ${hours} год ${rest} хв` : `через ${hours} год`;
}
