type Period = { start?: unknown; end?: unknown; goal?: unknown; updatedAt?: unknown };
type Schedule = { defaultGoal?: unknown; periods?: unknown; overrides?: unknown };

const FALLBACK_DAILY_ADS = 100;

export function resolveDailyPublicationGoal(valueJson: string | null | undefined, date: string): number {
  const schedule = parseSchedule(valueJson);
  if (!schedule) return FALLBACK_DAILY_ADS;
  const override = record(schedule.overrides)?.[date];
  const overrideAds = adsGoal(record(override)?.goal ?? override);
  if (overrideAds !== null) return overrideAds;

  const periods = Array.isArray(schedule.periods) ? schedule.periods.filter(record) as Period[] : [];
  const matches = periods.filter((period) => text(period.start) <= date && date <= text(period.end));
  matches.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const periodAds = adsGoal(matches[0]?.goal);
  if (periodAds !== null) return periodAds;
  return adsGoal(schedule.defaultGoal) ?? FALLBACK_DAILY_ADS;
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

function adsGoal(value: unknown): number | null {
  const source = record(value);
  const ads = Number(source?.ads);
  return Number.isInteger(ads) && ads >= 0 && ads <= 100000 ? ads : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
