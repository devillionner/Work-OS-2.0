import { SUBJECT_OPTIONS, canonicalKnownSubject } from './subjects.ts';

// Довідники Бібліотеки: напрямки (предмети), теги й гілки скриптів. Один рядок `user_settings`; порядок у ньому — порядок у списках.
export const DICTIONARY_KINDS = ['directions', 'tags', 'branches'] as const;
export type DictionaryKind = (typeof DICTIONARY_KINDS)[number];
export type Dictionaries = Record<DictionaryKind, string[]>;
export const DICTIONARY_SETTING_KEY = 'library_dictionaries';
export const DICTIONARY_LIMIT = 200;

export const isDictionaryKind = (value: unknown): value is DictionaryKind => typeof value === 'string' && (DICTIONARY_KINDS as readonly string[]).includes(value);
export const cleanDictionaryName = (value: unknown): string => (typeof value === 'string' ? Array.from(value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().normalize('NFC')).slice(0, 50).join('') : '');
export const sameName = (a: string, b: string) => a.toLocaleLowerCase('uk-UA') === b.toLocaleLowerCase('uk-UA');
/** Стандартні предмети Work OS використовуються для підбору оголошень чатам, тож не перейменовуються. */
export const isStandardDirection = (name: string) => canonicalKnownSubject(name) !== null && (SUBJECT_OPTIONS as readonly string[]).includes(name);

export function cleanNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const name = cleanDictionaryName(item);
    const key = name.toLocaleLowerCase('uk-UA');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, DICTIONARY_LIMIT);
}

export function parseDictionaries(json: string | null | undefined): Dictionaries | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<Record<DictionaryKind, unknown>>;
    return { directions: cleanNames(value.directions), tags: cleanNames(value.tags), branches: cleanNames(value.branches) };
  } catch {
    return null;
  }
}

type ItemUse = { tags: string[]; branch: string };

/**
 * Довідники для показу: збережені списки плюс усе, що вже вжито в матеріалах, але ще не внесено (нові теги з полів, старі
 * записи). Без збережених списків напрямки починаються зі стандартних предметів.
 */
export function mergeDictionaries(saved: Dictionaries | null, items: readonly ItemUse[]): Dictionaries {
  const result: Dictionaries = saved ? { directions: [...saved.directions], tags: [...saved.tags], branches: [...saved.branches] } : { directions: [...SUBJECT_OPTIONS], tags: [], branches: [] };
  const known = new Set([...result.directions, ...result.tags].map((name) => name.toLocaleLowerCase('uk-UA')));
  const knownBranches = new Set(result.branches.map((name) => name.toLocaleLowerCase('uk-UA')));
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.toLocaleLowerCase('uk-UA');
      if (known.has(key)) continue;
      known.add(key);
      (isStandardDirection(tag) ? result.directions : result.tags).push(tag);
    }
    const branch = item.branch.trim();
    if (branch && !knownBranches.has(branch.toLocaleLowerCase('uk-UA'))) { knownBranches.add(branch.toLocaleLowerCase('uk-UA')); result.branches.push(branch); }
  }
  return result;
}

/** Скільки матеріалів вживає кожен запис довідника. */
export function dictionaryUsage(dictionaries: Dictionaries, items: readonly ItemUse[]): Record<DictionaryKind, Record<string, number>> {
  const usage: Record<DictionaryKind, Record<string, number>> = { directions: {}, tags: {}, branches: {} };
  for (const kind of ['directions', 'tags'] as const) {
    for (const name of dictionaries[kind]) usage[kind][name] = items.filter((item) => item.tags.some((tag) => sameName(tag, name))).length;
  }
  for (const name of dictionaries.branches) usage.branches[name] = items.filter((item) => sameName(item.branch, name)).length;
  return usage;
}
