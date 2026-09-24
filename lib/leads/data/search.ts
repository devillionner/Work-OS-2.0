import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

// SQLite lower() folds ASCII only. Cover Ukrainian/Russian names without a
// second persisted search source that legacy imports would need to maintain.
// The alphabet is a fixed application literal, so keep its replace() arguments
// inline instead of consuming two D1 bind variables per letter on every use.
export function foldedName(column: SQLWrapper): SQL {
  return 'АБВГҐДЕЄЁЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
    .split('')
    .reduce(
      (value, letter) =>
        sql`replace(${value},${sql.raw(`'${letter}'`)},${sql.raw(`'${letter.toLowerCase()}'`)})`,
      sql`lower(${column})`,
    );
}

export type LeadSearchAlias =
  | 'response'
  | 'clarification'
  | 'booked'
  | 'reminder'
  | 'lesson'
  | 'result'
  | 'curator'
  | 'new'
  | 'active'
  | 'won'
  | 'lost';

const aliasTerms: Record<LeadSearchAlias, readonly string[]> = {
  response: ['відгук', 'отклик', 'response'],
  clarification: ['уточнення', 'уточнити', 'потрібно уточнити', 'нужно уточнить', 'clarification'],
  booked: ['запис', 'записано', 'записаний', 'записана', 'booked'],
  reminder: ['нагадування', 'нагадати', 'напоминание', 'reminder'],
  lesson: ['урок', 'заняття', 'занятие', 'lesson'],
  result: ['результат', 'result'],
  curator: ['куратор', 'у куратора', 'curator'],
  new: ['новий', 'нова', 'новый', 'new'],
  active: ['у роботі', 'в роботі', 'в работе', 'active'],
  won: ['успішний', 'успішна', 'успешный', 'won'],
  lost: ['закритий', 'закрита', 'закрытый', 'lost'],
};

const platformTerms: Record<string, readonly string[]> = {
  telegram: ['telegram', 'телеграм', 'тг'],
  whatsapp: ['whatsapp', 'whatapp', 'вацап', 'ватсап', 'вотсап', 'wa'],
  viber: ['viber', 'вайбер'],
  facebook: ['facebook', 'фейсбук', 'fb'],
  threads: ['threads', 'тредс'],
};

export function leadSearchAliases(value: string): LeadSearchAlias[] {
  const normalized = value.trim().toLocaleLowerCase('uk-UA');
  if (!normalized) return [];
  return (Object.entries(aliasTerms) as Array<[LeadSearchAlias, readonly string[]]>)
    .filter(([, terms]) => terms.some((term) => normalized.includes(term)))
    .map(([alias]) => alias);
}

function matchesPlatformTerm(normalized: string, term: string) {
  if (normalized === term || normalized.includes(term)) return true;
  // Incremental search is useful for operator-facing names, but expanding a
  // one/two-character fragment (for example "a") would silently match several
  // unrelated platforms and pollute the authoritative D1 result set.
  return normalized.length >= 3 && term.startsWith(normalized);
}

export function leadPlatformSearchValues(value: string): string[] {
  const normalized = value.trim().toLocaleLowerCase('uk-UA');
  if (!normalized) return [];
  return Object.entries(platformTerms)
    .filter(([platform, terms]) =>
      matchesPlatformTerm(normalized, platform) || terms.some((term) => matchesPlatformTerm(normalized, term)),
    )
    .map(([platform]) => platform);
}
