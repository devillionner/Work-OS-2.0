export const FOCUS_DIRECTIONS = [
  'Англійська',
  'Німецька',
  'Польська',
  'Математика',
  'Шкільні предмети — комплексно',
  'Логопедія та дефектологія',
  'Малювання',
  'ІТ та шахи',
] as const;

export type FocusDirection = typeof FOCUS_DIRECTIONS[number];

const ALIASES = new Map<string, FocusDirection>([
  ['англійська', 'Англійська'],
  ['английский', 'Англійська'],
  ['німецька', 'Німецька'],
  ['немецкий', 'Німецька'],
  ['польська', 'Польська'],
  ['польский', 'Польська'],
  ['математика', 'Математика'],
  ['шкільні предмети — комплексно', 'Шкільні предмети — комплексно'],
  ['шкільні предмети - комплексно', 'Шкільні предмети — комплексно'],
  ['шкільні предмети', 'Шкільні предмети — комплексно'],
  ['логопедія та дефектологія', 'Логопедія та дефектологія'],
  ['логопедія', 'Логопедія та дефектологія'],
  ['дефектологія', 'Логопедія та дефектологія'],
  ['малювання', 'Малювання'],
  ['рисование', 'Малювання'],
  ['іт та шахи', 'ІТ та шахи'],
  ['it та шахи', 'ІТ та шахи'],
  ['програмування та it', 'ІТ та шахи'],
  ['програмування та іт', 'ІТ та шахи'],
  ['програмування', 'ІТ та шахи'],
  ['programming', 'ІТ та шахи'],
  ['it', 'ІТ та шахи'],
  ['іт', 'ІТ та шахи'],
  ['шахи', 'ІТ та шахи'],
  ['шахматы', 'ІТ та шахи'],
]);

export function canonicalDirection(value: string): string {
  const trimmed = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return ALIASES.get(normalizeDirection(trimmed)) || trimmed;
}

export function canonicalDirections(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = canonicalDirection(value);
    if (!canonical) continue;
    const key = normalizeDirection(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

export function focusDirectionForTag(value: string): FocusDirection | null {
  const canonical = canonicalDirection(value);
  if ((FOCUS_DIRECTIONS as readonly string[]).includes(canonical)) return canonical as FocusDirection;
  const normalized = normalizeDirection(value);
  for (const direction of FOCUS_DIRECTIONS) {
    const target = normalizeDirection(direction);
    if (normalized.length >= 4 && target.length >= 4 && (normalized.includes(target) || target.includes(normalized))) return direction;
  }
  return null;
}

export function sameDirections(left: readonly string[], right: readonly string[]): boolean {
  const a = canonicalDirections(left).map(normalizeDirection).sort();
  const b = canonicalDirections(right).map(normalizeDirection).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeDirection(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
}
