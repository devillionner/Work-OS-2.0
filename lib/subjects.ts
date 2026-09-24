export const SUBJECT_OPTIONS = [
  'Англійська',
  'Німецька',
  'Польська',
  'Французька',
  'Італійська',
  'Іспанська',
  'Чеська',
  'Математика',
  'Шкільні предмети — комплексно',
  'Логопедія та дефектологія',
  'Малювання',
  'Шахи',
  'ІТ',
] as const;

export type CanonicalSubject = (typeof SUBJECT_OPTIONS)[number];

const SUBJECT_ALIASES: ReadonlyArray<
  readonly [CanonicalSubject, readonly string[]]
> = [
  ['Англійська', ['англійська', 'англійська мова', 'англійський', 'английский', 'английский язык', 'english', 'англ']],
  ['Німецька', ['німецька', 'німецька мова', 'німецький', 'немецкий', 'немецкий язык', 'german']],
  ['Польська', ['польська', 'польська мова', 'польський', 'польский', 'польский язык', 'polish']],
  ['Французька', ['французька', 'французька мова', 'французький', 'французский', 'французский язык', 'french']],
  ['Італійська', ['італійська', 'італійська мова', 'італійський', 'итальянский', 'итальянский язык', 'italian']],
  ['Іспанська', ['іспанська', 'іспанська мова', 'іспанський', 'испанский', 'испанский язык', 'spanish']],
  ['Чеська', ['чеська', 'чеська мова', 'чеський', 'чешский', 'чешский язык', 'czech']],
  ['Математика', ['математика', 'матем', 'math', 'алгебра', 'геометрія', 'геометрия']],
  ['Шкільні предмети — комплексно', ['шкільні предмети — комплексно', 'шкільні предмети - комплексно', 'шкільні предмети', 'школьные предметы', 'school subjects']],
  ['Логопедія та дефектологія', ['логопедія та дефектологія', 'логопедия и дефектология', 'логопедія', 'логопедия', 'логопед', 'дефектологія', 'дефектология', 'дефектолог']],
  ['Малювання', ['малювання', 'рисование', 'drawing', 'art']],
  ['Шахи', ['шахи', 'шахматы', 'chess']],
  ['ІТ', ['іт', 'it', 'програмування', 'программирование', 'programming', 'програмування та it', 'програмування та іт', 'it для дітей', 'іт для дітей']],
];

const ALIAS_TO_SUBJECT = new Map<string, CanonicalSubject>();
const SUBJECT_TO_ALIASES = new Map<CanonicalSubject, readonly string[]>();

for (const [subject, aliases] of SUBJECT_ALIASES) {
  const all = [subject, ...aliases];
  SUBJECT_TO_ALIASES.set(subject, all);
  for (const alias of all) ALIAS_TO_SUBJECT.set(subjectKey(alias), subject);
}

export function cleanSubjectValue(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function canonicalKnownSubject(
  value: string | null | undefined,
): CanonicalSubject | null {
  const clean = cleanSubjectValue(value);
  return clean ? ALIAS_TO_SUBJECT.get(subjectKey(clean)) ?? null : null;
}
export function canonicalSubjectValue(
  value: string | null | undefined,
): string {
  const clean = cleanSubjectValue(value);
  if (!clean) return '';
  return canonicalKnownSubject(clean) ?? clean;
}

export function canonicalSubject(
  value: string | null | undefined,
): string {
  return canonicalSubjectValue(value) || 'Предмет не вказано';
}

export function canonicalSubjectList(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = canonicalSubjectValue(value);
    if (!canonical) continue;
    const key = subjectKey(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

export function subjectSearchVariants(value: string): string[] {
  const clean = cleanSubjectValue(value);
  if (!clean) return [];
  const known = canonicalKnownSubject(clean);
  const source = known ? (SUBJECT_TO_ALIASES.get(known) ?? [known]) : [clean];
  const variants = source.flatMap(caseVariants);
  return [...new Set(variants)];
}

function caseVariants(value: string): string[] {
  const lower = value.toLocaleLowerCase('uk-UA');
  const upper = lower.toLocaleUpperCase('uk-UA');
  const title = lower
    .split(/(\s+)/)
    .map((part) =>
      part.trim()
        ? `${part.charAt(0).toLocaleUpperCase('uk-UA')}${part.slice(1)}`
        : part,
    )
    .join('');
  return [value, lower, upper, title];
}

function subjectKey(value: string): string {
  return cleanSubjectValue(value)
    .toLocaleLowerCase('uk-UA')
    .replace(/[._,/\\()–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
