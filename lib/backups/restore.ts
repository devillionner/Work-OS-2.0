import { cloudBackupSha256 } from './inspect.ts';
import type { BackupTable } from './export.ts';

export const RESTORE_TABLES: BackupTable[] = [
  'legacy_imports', 'legacy_import_chunks', 'telegram_accounts', 'work_timers', 'workdays',
  'chats', 'chat_profiles', 'chat_publications', 'telegram_schedule_settings', 'telegram_schedule_slots',
  'leads', 'students', 'lessons',
  'curator_requests', 'lesson_reminders', 'lead_messages', 'lead_commands',
  'daily_reports', 'library_items', 'user_settings', 'activity_events',
];

const CONFLICT_COLUMNS: Record<BackupTable, string[]> = {
  legacy_imports: ['id'], legacy_import_chunks: ['import_id', 'chunk_index'],
  telegram_accounts: ['id'], work_timers: ['id'], workdays: ['id'], chats: ['id'],
  chat_profiles: ['chat_id'], chat_publications: ['id'],
  telegram_schedule_settings: ['user_id', 'telegram_account_id'], telegram_schedule_slots: ['id'], leads: ['id'],
  students: ['id'], lessons: ['id'], curator_requests: ['id'],
  lesson_reminders: ['id'], lead_messages: ['id'], lead_commands: ['id'],
  daily_reports: ['id'], library_items: ['id'],
  user_settings: ['user_id', 'setting_key'], activity_events: ['id'],
};

type RestoreValue = string | number | null;
type TableInfo = { name: string };

export async function restoreMissingChunk(args: {
  db: D1Database; table: BackupTable; payload: string; sha256: string;
  rowCount: number; userId: string;
}): Promise<{ inserted: number; rows: number }> {
  const { db, table, payload, sha256, rowCount, userId } = args;
  if (await cloudBackupSha256(payload) !== sha256) throw new Error('Контрольна сума staging-порції не збігається.');
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { throw new Error('Staging-порція не є коректним JSON.'); }
  if (!Array.isArray(parsed) || parsed.length !== rowCount || parsed.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Staging-порція має некоректну структуру.');
  const schema = await db.prepare(`PRAGMA table_info(${table})`).all<TableInfo>();
  const allowed = new Set(schema.results.map((column) => column.name).filter(identifier));
  const conflict = CONFLICT_COLUMNS[table];
  if (!allowed.size || conflict.some((column) => !allowed.has(column))) throw new Error(`Схема таблиці «${table}» не відповідає копії.`);
  const normalized = (parsed as Array<Record<string, unknown>>).map((source) => {
    const row = { ...source };
    if (allowed.has('user_id')) row.user_id = userId;
    return row;
  });
  if (allowed.has('user_id') && conflict.length === 1 && conflict[0] === 'id' && normalized.length) {
    const ownership = await db.batch<{ user_id?: string }>(normalized.map((row) => db.prepare(`SELECT user_id FROM ${quote(table)} WHERE id=?1 LIMIT 1`).bind(restoreValue(row.id, table, 'id'))));
    if (ownership.some((result) => result.results[0]?.user_id && result.results[0].user_id !== userId)) throw new Error(`У таблиці «${table}» знайдено конфлікт ID з іншим власником.`);
  }
  const statements = normalized.map((row) => {
    const columns = Object.keys(row).filter((column) => allowed.has(column));
    if (conflict.some((column) => !columns.includes(column))) throw new Error(`У staging-порції «${table}» відсутній ключ.`);
    const values = columns.map((column) => restoreValue(row[column], table, column));
    const names = columns.map(quote).join(',');
    const placeholders = columns.map((_, index) => `?${index + 1}`).join(',');
    return db.prepare(`INSERT INTO ${quote(table)} (${names}) VALUES (${placeholders}) ON CONFLICT (${conflict.map(quote).join(',')}) DO NOTHING`).bind(...values);
  });
  if (!statements.length) return { inserted: 0, rows: 0 };
  const results = await db.batch(statements);
  return { inserted: results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0), rows: statements.length };
}

function restoreValue(value: unknown, table: string, column: string): RestoreValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new Error(`Некоректне значення у «${table}.${column}».`);
}
function identifier(value: string) { return /^[a-z][a-z0-9_]*$/i.test(value); }
function quote(value: string) { if (!identifier(value)) throw new Error('Некоректний SQL-ідентифікатор.'); return `"${value}"`; }
