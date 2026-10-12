import type { AnalyticsPeriod, PlatformRow } from './types';

// Пороги в одному місці. Усе рахується на клієнті з уже завантажених даних.
/** Значуща зміна показника: |Δ| ≥ 20 % при базі (попередній період) не менше 5 подій. */
export const DELTA_SIGNIFICANT = 0.2;
export const DELTA_MIN_BASE = 5;
/** «Просідає»: відгук на оголошення впав щонайменше на 30 % відносно порівняльного періоду. */
export const CONVERSION_DROP = 0.3;
/** Достатня вибірка: хоча б 20 оголошень або 5 відгуків; менше — «Мала вибірка» замість висновку. */
export const SAMPLE_MIN_PUBLICATIONS = 20;
export const SAMPLE_MIN_RESPONSES = 5;

export type PlatformMetric = 'responses' | 'bookings' | 'completed' | 'conversion';
export type CountMetric = Exclude<PlatformMetric, 'conversion'>;
export type PlatformMark = 'best' | 'drop' | 'small' | null;

export const METRIC_ITEMS: ReadonlyArray<{ value: PlatformMetric; label: string }> = [
  { value: 'responses', label: 'Відгуки' },
  { value: 'bookings', label: 'Записи' },
  { value: 'completed', label: 'Проведені' },
  { value: 'conversion', label: 'Конверсія' },
];

export type PlatformPair = { key: string; name: string; current: PlatformRow; previous: PlatformRow | null };

const emptyRow = (key: string, name: string): PlatformRow => ({
  key, name, joined: 0, publications: 0, responses: 0, bookings: 0, completed: 0, publicationRate: 0, responseRate: 0, bookingRate: 0, completionRate: 0,
});

const hasActivity = (row: PlatformRow) => row.publications + row.responses + row.bookings + row.completed > 0;

/**
 * Платформи двох періодів за ключем. Платформа, що була лише в попередньому періоді, лишається рядком з нулями:
 * саме так видно, що вона перестала давати результат. Платформи з самими приєднаннями (без результату) не показуємо.
 */
export function pairPlatforms(current: readonly PlatformRow[], previous: readonly PlatformRow[] | null): PlatformPair[] {
  const currentByKey = new Map(current.map((row) => [row.key, row]));
  const previousByKey = new Map((previous ?? []).map((row) => [row.key, row]));
  const keys = [...new Set([...currentByKey.keys(), ...previousByKey.keys()])];
  return keys
    .map((key): PlatformPair => {
      const now = currentByKey.get(key);
      const before = previousByKey.get(key);
      const name = now?.name ?? before?.name ?? key;
      return { key, name, current: now ?? emptyRow(key, name), previous: previous ? (before ?? emptyRow(key, name)) : null };
    })
    .filter((pair) => hasActivity(pair.current) || (pair.previous !== null && hasActivity(pair.previous)));
}

export type Delta = { kind: 'none' } | { kind: 'new' } | { kind: 'change'; ratio: number; significant: boolean };

export function countDelta(current: number, previous: number | null): Delta {
  if (previous === null) return { kind: 'none' };
  if (previous === 0) return current > 0 ? { kind: 'new' } : { kind: 'none' };
  const ratio = (current - previous) / previous;
  return { kind: 'change', ratio, significant: previous >= DELTA_MIN_BASE && Math.abs(ratio) >= DELTA_SIGNIFICANT };
}

export type CountRow = PlatformPair & { value: number; share: number; sharePercent: number; delta: Delta };

/** Цілі відсотки, що в сумі дають рівно 100: решту після округлення вниз роздаємо за найбільшою дробовою частиною. */
function wholePercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** Рейтинг за відгуками, записами чи проведеними: частка від суми всіх платформ і зміна до порівняльного періоду. */
export function rankByCount(pairs: readonly PlatformPair[], metric: CountMetric): CountRow[] {
  const total = pairs.reduce((sum, pair) => sum + pair.current[metric], 0);
  const sorted = [...pairs].sort((a, b) => b.current[metric] - a.current[metric] || (b.previous?.[metric] ?? 0) - (a.previous?.[metric] ?? 0) || a.name.localeCompare(b.name, 'uk'));
  const percents = wholePercents(sorted.map((pair) => pair.current[metric]));
  return sorted.map((pair, index) => ({
    ...pair,
    value: pair.current[metric],
    share: total > 0 ? pair.current[metric] / total : 0,
    sharePercent: percents[index],
    delta: countDelta(pair.current[metric], pair.previous ? pair.previous[metric] : null),
  }));
}

export const hasEnoughSample = (row: Pick<PlatformRow, 'publications' | 'responses'>) => row.publications >= SAMPLE_MIN_PUBLICATIONS || row.responses >= SAMPLE_MIN_RESPONSES;

/** Відгук на оголошення як частка (0–1); без оголошень — `null`. */
export const responseRatio = (row: Pick<PlatformRow, 'publications' | 'responses'>): number | null => (row.publications > 0 ? row.responses / row.publications : null);

export type ConversionRow = PlatformPair & { rate: number | null; previousRate: number | null; mark: PlatformMark };

/**
 * Воронки платформ, найкращі зверху. Платформи з достатньою вибіркою йдуть першими, із малою — після них, без висновку.
 * Мітки: «Просідає» (падіння ≥ 30 % при достатній вибірці в обох періодах), «Найкраща» (єдина з найвищою конверсією серед
 * щонайменше двох платформ із достатньою вибіркою; просідаюча платформа не вважається найкращою), «Мала вибірка».
 */
export function rankConversion(pairs: readonly PlatformPair[]): ConversionRow[] {
  const rows = pairs.map((pair): ConversionRow => {
    const rate = responseRatio(pair.current);
    const previousRate = pair.previous ? responseRatio(pair.previous) : null;
    const enough = hasEnoughSample(pair.current);
    const drops = enough && pair.previous !== null && hasEnoughSample(pair.previous) && rate !== null && previousRate !== null && previousRate > 0 && (rate - previousRate) / previousRate <= -CONVERSION_DROP;
    return { ...pair, rate, previousRate, mark: !enough ? 'small' : drops ? 'drop' : null };
  });
  const reliable = rows.filter((row) => row.mark !== 'small');
  const top = Math.max(0, ...reliable.map((row) => row.rate ?? 0));
  const leaders = reliable.filter((row) => (row.rate ?? 0) === top);
  const leader = reliable.length >= 2 && top > 0 && leaders.length === 1 && leaders[0].mark === null ? leaders[0] : null;
  return rows
    .map((row) => (row === leader ? { ...row, mark: 'best' as const } : row))
    .sort((a, b) => Number(a.mark === 'small') - Number(b.mark === 'small') || (b.rate ?? 0) - (a.rate ?? 0) || b.current.publications - a.current.publications || a.name.localeCompare(b.name, 'uk'));
}

export const percentLabel = (ratio: number): string => `${(ratio * 100).toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;

const COMPARED_TO: Record<AnalyticsPeriod, string> = {
  day: 'учора',
  week: 'минулого тижня',
  month: 'у ті самі дні минулого місяця',
  year: 'у цей самий період минулого року',
  custom: 'у попередньому періоді тієї ж довжини',
};

function nameList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} і ${names[names.length - 1]}`;
}

/** Підсумок для верхівки картки: одне-два речення, зібрані детерміновано з чисел. */
export function summarizePlatforms(pairs: readonly PlatformPair[], period: AnalyticsPeriod): string {
  const reliable = pairs.filter((pair) => hasEnoughSample(pair.current));
  if (reliable.length === 0) {
    return `Даних замало для висновків: ні в однієї платформи немає ${SAMPLE_MIN_PUBLICATIONS} оголошень чи ${SAMPLE_MIN_RESPONSES} відгуків за період.`;
  }
  const leaderSentence = (metric: 'bookings' | 'responses', noun: string, prefix = ''): string | null => {
    const total = pairs.reduce((sum, pair) => sum + pair.current[metric], 0);
    if (total === 0) return null;
    const top = Math.max(...pairs.map((pair) => pair.current[metric]));
    const names = pairs.filter((pair) => pair.current[metric] === top).map((pair) => pair.name);
    return names.length === 1
      ? `${prefix}Найбільше ${noun} дає ${names[0]} — ${top} з ${total}.`
      : `${prefix}Найбільше ${noun} — по ${top} — дають ${nameList(names)}.`;
  };
  const first = leaderSentence('bookings', 'записів') ?? leaderSentence('responses', 'відгуків', 'Записів поки немає. ') ?? 'За період платформи не принесли ні відгуків, ні записів.';

  const ranked = rankConversion(pairs);
  const dropping = ranked.filter((row) => row.mark === 'drop' && row.rate !== null && row.previousRate !== null).sort((a, b) => ((a.rate ?? 0) / (a.previousRate ?? 1)) - ((b.rate ?? 0) / (b.previousRate ?? 1)));
  const worst = dropping[0];
  if (worst && worst.rate !== null && worst.previousRate !== null) {
    const verb = dropping.length > 1 ? `Найбільше просідає ${worst.name}` : `${worst.name} просідає`;
    return `${first} ${verb}: відгук на оголошення ${percentLabel(worst.rate)} проти ${percentLabel(worst.previousRate)} ${COMPARED_TO[period]}.`;
  }
  const best = ranked.find((row) => row.mark === 'best');
  if (best && best.rate !== null) return `${first} Найвищий відгук на оголошення — у ${best.name}: ${percentLabel(best.rate)}.`;
  return first;
}
