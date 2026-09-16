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
