import { canonicalSubjectValue, cleanSubjectValue } from './subjects.ts';

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

export type FocusDirection = (typeof FOCUS_DIRECTIONS)[number];

const FOCUS_BY_SUBJECT = new Map<string, FocusDirection>([
  ['Англійська', 'Англійська'],
  ['Німецька', 'Німецька'],
  ['Польська', 'Польська'],
  ['Математика', 'Математика'],
  ['Шкільні предмети — комплексно', 'Шкільні предмети — комплексно'],
  ['Логопедія та дефектологія', 'Логопедія та дефектологія'],
  ['Малювання', 'Малювання'],
  ['ІТ', 'ІТ та шахи'],
  ['Шахи', 'ІТ та шахи'],
]);

const COMBINED_IT_CHESS = new Set([
  'іт та шахи',
  'it та шахи',
  'it и шахматы',
  'іт і шахи',
]);
export function canonicalDirection(value: string): string {
  const clean = cleanSubjectValue(value);
  if (!clean) return '';
  if (COMBINED_IT_CHESS.has(normalizeDirection(clean))) return 'ІТ та шахи';
  const canonical = canonicalSubjectValue(clean);
  return FOCUS_BY_SUBJECT.get(canonical) ?? canonical;
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
  if ((FOCUS_DIRECTIONS as readonly string[]).includes(canonical))
    return canonical as FocusDirection;
  return null;
}

export function sameDirections(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = canonicalDirections(left).map(normalizeDirection).sort();
  const b = canonicalDirections(right).map(normalizeDirection).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeDirection(value: string): string {
  return cleanSubjectValue(value).toLocaleLowerCase('uk-UA');
}
