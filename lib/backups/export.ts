// SQL identifiers below are compile-time allowlists. Export every column so
// additive domain fields and legacy provenance survive a round trip.
export const BACKUP_TABLES = [
  'legacy_imports',
  'legacy_import_chunks',
  'telegram_accounts',
  'work_timers',
  'workdays',
  'chats',
  'chat_profiles',
  'chat_publications',
  'telegram_schedule_settings',
  'telegram_schedule_slots',
  'leads',
  'students',
  'lessons',
  'curator_requests',
  'lesson_reminders',
  'lead_messages',
  'lead_message_attachments',
  'lead_message_attachment_chunks',
  'lead_commands',
  'daily_reports',
  'report_checkpoints',
  'goal_versions',
  'library_items',
  'library_item_versions',
  'user_settings',
  'activity_events',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
const cursorColumn = (table: BackupTable) =>
  table === 'chat_profiles'
    ? 'chat_id'
    : table === 'telegram_schedule_settings'
      ? 'telegram_account_id'
    : table === 'user_settings'
      ? 'setting_key'
      : table === 'legacy_import_chunks'
        ? 'rowid'
        : 'id';
function selection(table: BackupTable) {
  if (table === 'chat_profiles')
    return 'FROM chat_profiles t WHERE EXISTS(SELECT 1 FROM chats c WHERE c.id=t.chat_id AND c.user_id=?1)';
  if (table === 'legacy_import_chunks')
    return 'FROM legacy_import_chunks t WHERE EXISTS(SELECT 1 FROM legacy_imports i WHERE i.id=t.import_id AND i.user_id=?1)';
  return `FROM ${table} t WHERE t.user_id=?1`;
}
const revisionQuery = (db: D1Database, userId: string) =>
  db
    .prepare(
      'SELECT COALESCE((SELECT revision FROM backup_revisions WHERE user_id=?),0) revision',
    )
    .bind(userId);
export async function backupManifest(db: D1Database, userId: string) {
  const result = await db.batch<{ count?: number; revision?: number }>([
    revisionQuery(db, userId),
    ...BACKUP_TABLES.map((table) =>
      db.prepare(`SELECT count(*) count ${selection(table)}`).bind(userId),
    ),
  ]);
  return {
    revision: result[0].results[0].revision!,
    counts: Object.fromEntries(
      BACKUP_TABLES.map((table, i) => [table, result[i + 1].results[0].count!]),
    ),
  };
}
export class BackupConflict extends Error {}
export async function backupPage(
  db: D1Database,
  userId: string,
  table: BackupTable,
  cursor: string,
  revision: number,
) {
  const column = cursorColumn(table);
  const size =
    table === 'lead_message_attachment_chunks'
      ? 1
      : table === 'legacy_import_chunks'
        ? 10
        : 200;
  const comparison =
    column === 'rowid'
      ? "(?2='' OR t.rowid>CAST(?2 AS INTEGER))"
      : `t.${column}>?2`;
  const results = await db.batch<Record<string, unknown>>([
    revisionQuery(db, userId),
    db
      .prepare(
        `SELECT t.*,t.${column} AS backup_cursor ${selection(table)} AND ${comparison} ORDER BY t.${column} LIMIT ?3`,
      )
      .bind(userId, cursor, size),
  ]);
  if (results[0].results[0].revision !== revision)
    throw new BackupConflict(
      'Дані змінилися під час копіювання. Створіть копію ще раз.',
    );
  const rows = results[1].results;
  const nextCursor =
    rows.length === size ? String(rows.at(-1)!.backup_cursor) : null;
  return {
    table,
    rows: rows.map(({ backup_cursor: _cursor, ...row }) => row),
    nextCursor,
  };
}