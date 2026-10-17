// Ручні нагадування ліду: масив JSON у `leads.custom_reminders_json` і найближчий час невиконаного в
// `leads.next_custom_reminder_at` (його читає запит «Сьогодні» через частковий індекс, без розбору JSON).
export type CustomReminder = { id: string; text: string; at: number; doneAt: number | null };

export const CUSTOM_REMINDER_TEXT_MAX = 300;
/** Скільки нагадувань тримає один лід: решта виконаних із найдавнішою датою відкидається. */
export const CUSTOM_REMINDER_LIMIT = 40;
const FAR_FUTURE_SECONDS = 3 * 365 * 24 * 3600;

export function parseCustomReminders(json: string | null | undefined): CustomReminder[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    const items: CustomReminder[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.at !== 'number') continue;
      items.push({ id: item.id, text: item.text, at: item.at, doneAt: typeof item.doneAt === 'number' ? item.doneAt : null });
    }
    return items;
  } catch {
    return [];
  }
}

export const nextCustomReminderAt = (items: readonly CustomReminder[]): number | null =>
  items.filter((item) => item.doneAt === null).reduce<number | null>((min, item) => (min === null || item.at < min ? item.at : min), null);

/** Виконані найдавніші відкидаються, щоб JSON не ріс безмежно; невиконані не губляться ніколи. */
export function trimCustomReminders(items: readonly CustomReminder[]): CustomReminder[] {
  if (items.length <= CUSTOM_REMINDER_LIMIT) return [...items];
  const open = items.filter((item) => item.doneAt === null);
  const done = items.filter((item) => item.doneAt !== null).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return [...open, ...done.slice(0, Math.max(0, CUSTOM_REMINDER_LIMIT - open.length))];
}

export function validReminderText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= CUSTOM_REMINDER_TEXT_MAX ? text : null;
}

/** Час нагадування: цілі секунди Unix, не раніше за добу тому й не далі ніж за три роки. */
export function validReminderAt(value: unknown, now: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value >= now - 24 * 3600 && value <= now + FAR_FUTURE_SECONDS ? value : null;
}
