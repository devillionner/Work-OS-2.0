import { shiftBusinessDate } from './business-time.ts';

type Period = { start?: unknown; end?: unknown; goal?: unknown; updatedAt?: unknown };
type Schedule = { defaultGoal?: unknown; periods?: unknown; overrides?: unknown };

const FALLBACK_DAILY_ADS = 100;

export type DailyGoalField = 'ads' | 'chats' | 'responses' | 'records';

/** Денна ціль за полем (оголошення, нові чати, відгуки, записи) з розкладу цілей; null — цілі в розкладі немає. */
export function resolveDailyGoalField(valueJson: string | null | undefined, date: string, field: DailyGoalField): number | null {
  const schedule = parseSchedule(valueJson);
  if (!schedule) return null;
  const override = record(schedule.overrides)?.[date];
  const fromOverride = goalField(record(override)?.goal ?? override, field);
  if (fromOverride !== null) return fromOverride;

  const periods = Array.isArray(schedule.periods) ? schedule.periods.filter(record) as Period[] : [];
  const matches = periods.filter((period) => text(period.start) <= date && date <= text(period.end));
  matches.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const fromPeriod = goalField(matches[0]?.goal, field);
  if (fromPeriod !== null) return fromPeriod;
  return goalField(schedule.defaultGoal, field);
}

export function resolveDailyPublicationGoal(valueJson: string | null | undefined, date: string): number {
  return resolveDailyGoalField(valueJson, date, 'ads') ?? FALLBACK_DAILY_ADS;
}
function parseSchedule(valueJson: string | null | undefined): Schedule | null {
  if (!valueJson) return null;
  try {
    const outer = JSON.parse(valueJson) as unknown;
    const outerRecord = record(outer);
    if (!outerRecord) return null;
    const legacy = outerRecord.legacyStorageValue;
    const parsed = typeof legacy === 'string' ? JSON.parse(legacy) as unknown : outer;
    return record(parsed) as Schedule | null;
  } catch {
    return null;
  }
}

function goalField(value: unknown, field: DailyGoalField): number | null {
  const source = record(value);
  const raw = source?.[field];
  if (raw === undefined || raw === null || raw === '') return null;
  const goal = Number(raw);
  return Number.isInteger(goal) && goal >= 0 && goal <= 100000 ? goal : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/**
 * Записує денні цілі (оголошення, нові чати, відгуки) у розклад цілей: нові значення стають `defaultGoal`, а періоди й винятки,
 * що діють від сьогодні й пізніше, зникають або скорочуються до вчора — минулі дні зберігають свою ціль.
 * Структура рядка (включно з обгорткою `legacyStorageValue`) зберігається.
 */
export function applyDailyGoals(valueJson: string | null | undefined, today: string, goals: Partial<Record<'ads' | 'chats' | 'responses', number>>): string {
  let outer: Record<string, unknown> = {};
  try { outer = record(valueJson ? JSON.parse(valueJson) as unknown : null) ?? {}; } catch { outer = {}; }
  const legacy = outer.legacyStorageValue;
  let inner: Record<string, unknown> = outer;
  const wrapped = typeof legacy === 'string';
  if (wrapped) {
    try { inner = record(JSON.parse(legacy) as unknown) ?? {}; } catch { inner = {}; }
  }
  const yesterday = shiftBusinessDate(today, -1);
  const periods = (Array.isArray(inner.periods) ? inner.periods.filter(record) as Period[] : []).flatMap((period): Period[] => {
    if (text(period.end) < today) return [period];
    if (text(period.start) < today) return [{ ...period, end: yesterday }];
    return [];
  });
  const overrides = Object.fromEntries(Object.entries(record(inner.overrides) ?? {}).filter(([date]) => date < today));
  const next = { ...inner, defaultGoal: { ...record(inner.defaultGoal), ...goals }, periods, overrides };
  return JSON.stringify(wrapped ? { ...outer, legacyStorageValue: JSON.stringify(next) } : next);
}
