import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

// SQLite lower() folds ASCII only. Cover Ukrainian/Russian names without a
// second persisted search source that legacy imports would need to maintain.
export function foldedName(column: SQLWrapper): SQL {
  return 'АБВГҐДЕЄЁЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
    .split('')
    .reduce(
      (value, letter) =>
        sql`replace(${value},${letter},${letter.toLowerCase()})`,
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

export function leadSearchAliases(value: string): LeadSearchAlias[] {
  const normalized = value.trim().toLocaleLowerCase('uk-UA');
  if (!normalized) return [];
  return (Object.entries(aliasTerms) as Array<[LeadSearchAlias, readonly string[]]>)
    .filter(([, terms]) => terms.some((term) => normalized.includes(term)))
    .map(([alias]) => alias);
}
