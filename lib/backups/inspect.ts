import { BACKUP_TABLES, type BackupTable } from './export.ts';

export const CLOUD_BACKUP_APP = 'work-os-cloud-backup';
export const CLOUD_BACKUP_SCHEMA_VERSION = 12;
export const CLOUD_BACKUP_MIN_SCHEMA_VERSION = 5;
export const CLOUD_BACKUP_MAX_BYTES = 25 * 1024 * 1024;

type JsonRow = Record<string, unknown>;

export type CloudBackupInspection = {
  valid: boolean;
  schemaVersion: number | null;
  createdAt: string | null;
  ownerEmail: string | null;
  ownerId: string | null;
  revision: number | null;
  totalRecords: number;
  counts: Record<BackupTable, number>;
  errors: string[];
  warnings: string[];
};

type ParsedBackup = {
  app?: unknown;
  schemaVersion?: unknown;
  createdAt?: unknown;
  ownerEmail?: unknown;
  ownerId?: unknown;
  revision?: unknown;
  counts?: unknown;
  tables?: unknown;
};

const EMPTY_COUNTS = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0])) as Record<BackupTable, number>;

export function inspectCloudBackup(raw: string): CloudBackupInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts = { ...EMPTY_COUNTS };
  let parsed: ParsedBackup;

  try {
    parsed = JSON.parse(raw) as ParsedBackup;
  } catch {
    return emptyInspection(['Файл не є коректним JSON.']);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyInspection(['У файлі немає об’єкта резервної копії.']);
  if (parsed.app !== CLOUD_BACKUP_APP) errors.push('Це не резервна копія Work OS 2.0.');

  const schemaVersion = integer(parsed.schemaVersion);
  if (schemaVersion === null) {
    errors.push('Не вдалося визначити версію копії.');
  } else if (schemaVersion < CLOUD_BACKUP_MIN_SCHEMA_VERSION || schemaVersion > CLOUD_BACKUP_SCHEMA_VERSION) {
    errors.push(`Версія копії ${schemaVersion} не підтримується цією версією Work OS.`);
  } else if (schemaVersion < CLOUD_BACKUP_SCHEMA_VERSION) {
    warnings.push(`Копія має попередню сумісну схему ${schemaVersion}; відсутні нові розділи вважатимуться порожніми.`);
  }
  const ownerEmail = text(parsed.ownerEmail);
  const ownerId = text(parsed.ownerId);
  if (!ownerEmail || !ownerId) errors.push('У копії немає даних про власника.');
  const createdAt = text(parsed.createdAt);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) errors.push('У копії немає коректної дати створення.');
  const revision = integer(parsed.revision);
  if (revision === null || revision < 0) errors.push('У копії немає коректної версії даних.');

  const declaredCounts = record(parsed.counts);
  const tables = record(parsed.tables);
  if (!declaredCounts) errors.push('У копії немає контрольних кількостей.');
  if (!tables) errors.push('У копії немає таблиць із даними.');

  if (declaredCounts && tables) {
    for (const table of BACKUP_TABLES) {
      const tableRows = tables[table];
      const declared = integer(declaredCounts[table]);
      const introduced = table === 'library_items' ? 6
        : (table === 'telegram_schedule_settings' || table === 'telegram_schedule_slots') ? 7
        : table === 'workdays' ? 8
        : table === 'report_checkpoints' ? 9
        : table === 'goal_versions' ? 10
        : table === 'library_item_versions' ? 11
        : 1;
      if (schemaVersion !== null && schemaVersion < introduced && tableRows === undefined && declared === null) continue;
      if (!Array.isArray(tableRows)) {
        errors.push(`Розділ «${table}» відсутній або пошкоджений.`);
        continue;
      }
      if (tableRows.some((row) => !record(row))) errors.push(`Розділ «${table}» містить некоректні записи.`);
      counts[table] = tableRows.length;
      if (declared !== tableRows.length) errors.push(`Контрольна кількість для «${table}» не збігається: очікується ${declared ?? '—'}, отримано ${tableRows.length}.`);
      validateUniqueKeys(table, tableRows.filter(isRow), errors);
    }
    const unknownTables = Object.keys(tables).filter((table) => !BACKUP_TABLES.includes(table as BackupTable));
    if (unknownTables.length) warnings.push(`Знайдено невідомі розділи: ${unknownTables.join(', ')}.`);
    validateOwnership(tables, ownerId, errors);
    validateReferences(tables, errors);
  }

  return {
    valid: errors.length === 0,
    schemaVersion,
    createdAt: createdAt || null,
    ownerEmail: ownerEmail || null,
    ownerId: ownerId || null,
    revision,
    totalRecords: Object.values(counts).reduce((sum, value) => sum + value, 0),
    counts,
    errors,
    warnings,
  };
}

export async function cloudBackupSha256(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateUniqueKeys(table: BackupTable, rows: JsonRow[], errors: string[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = backupRowKey(table, row);
    if (!key) {
      errors.push(`У розділі «${table}» є запис без ключа.`);
      return;
    }
    if (keys.has(key)) {
      errors.push(`У розділі «${table}» дублюється ключ «${key}».`);
      return;
    }
    keys.add(key);
  }
}

function backupRowKey(table: BackupTable, row: JsonRow): string {
  if (table === 'chat_profiles') return text(row.chat_id);
  if (table === 'user_settings') return text(row.setting_key);
  if (table === 'telegram_schedule_settings') return `${text(row.user_id)}:${text(row.telegram_account_id)}`;
  if (table === 'legacy_import_chunks') {
    const importId = text(row.import_id);
    const chunkIndex = integer(row.chunk_index);
    return importId && chunkIndex !== null ? `${importId}:${chunkIndex}` : '';
  }
  return text(row.id);
}

function validateOwnership(tables: JsonRow, ownerId: string, errors: string[]) {
  if (!ownerId) return;
  for (const table of BACKUP_TABLES) {
    const tableRows = Array.isArray(tables[table]) ? (tables[table] as unknown[]).filter(isRow) : [];
    for (const row of tableRows) {
      if ('user_id' in row && text(row.user_id) !== ownerId) {
        errors.push(`Розділ «${table}» містить дані іншого власника.`);
        break;
      }
    }
  }
}

function validateReferences(tables: JsonRow, errors: string[]) {
  const ids = (table: BackupTable, column = 'id') => new Set(rows(tables, table).map((row) => text(row[column])).filter(Boolean));
  const chatIds = ids('chats');
  const leadIds = ids('leads');
  const studentIds = ids('students');
  const lessonIds = ids('lessons');
  const importIds = ids('legacy_imports');
  const accountIds = ids('telegram_accounts');
  const publicationIds = ids('chat_publications');
  const libraryIds = ids('library_items');
  checkReferences(rows(tables, 'chat_profiles'), 'chat_id', chatIds, 'chat_profiles → chats', errors, false);
  checkReferences(rows(tables, 'chat_publications'), 'chat_id', chatIds, 'chat_publications → chats', errors, false);
  checkReferences(rows(tables, 'students'), 'lead_id', leadIds, 'students → leads', errors, false);
  checkReferences(rows(tables, 'lessons'), 'lead_id', leadIds, 'lessons → leads', errors, false);
  checkReferences(rows(tables, 'lessons'), 'student_id', studentIds, 'lessons → students', errors, true);
  checkReferences(rows(tables, 'lesson_reminders'), 'lesson_id', lessonIds, 'lesson_reminders → lessons', errors, false);
  checkReferences(rows(tables, 'lead_messages'), 'lead_id', leadIds, 'lead_messages → leads', errors, false);
  checkReferences(rows(tables, 'lead_commands'), 'lead_id', leadIds, 'lead_commands → leads', errors, false);
  checkReferences(rows(tables, 'curator_requests'), 'lead_id', leadIds, 'curator_requests → leads', errors, false);
  checkReferences(rows(tables, 'curator_requests'), 'lesson_id', lessonIds, 'curator_requests → lessons', errors, true);
  checkReferences(rows(tables, 'work_timers'), 'telegram_account_id', accountIds, 'work_timers → telegram_accounts', errors, true);
  checkReferences(rows(tables, 'chats'), 'telegram_account_id', accountIds, 'chats → telegram_accounts', errors, true);
  checkReferences(rows(tables, 'chat_publications'), 'telegram_account_id', accountIds, 'chat_publications → telegram_accounts', errors, true);
  checkReferences(rows(tables, 'telegram_schedule_settings'), 'telegram_account_id', accountIds, 'telegram_schedule_settings → telegram_accounts', errors, false);
  checkReferences(rows(tables, 'telegram_schedule_slots'), 'telegram_account_id', accountIds, 'telegram_schedule_slots → telegram_accounts', errors, false);
  checkReferences(rows(tables, 'telegram_schedule_slots'), 'chat_id', chatIds, 'telegram_schedule_slots → chats', errors, true);
  checkReferences(rows(tables, 'telegram_schedule_slots'), 'publication_id', publicationIds, 'telegram_schedule_slots → chat_publications', errors, true);
  checkReferences(rows(tables, 'activity_events'), 'telegram_account_id', accountIds, 'activity_events → telegram_accounts', errors, true);
  checkReferences(rows(tables, 'activity_events'), 'chat_id', chatIds, 'activity_events → chats', errors, true);
  checkReferences(rows(tables, 'activity_events'), 'lead_id', leadIds, 'activity_events → leads', errors, true);
  checkReferences(rows(tables, 'activity_events'), 'lesson_id', lessonIds, 'activity_events → lessons', errors, true);
  checkReferences(rows(tables, 'library_item_versions'), 'item_id', libraryIds, 'library_item_versions → library_items', errors, false);
  checkReferences(rows(tables, 'legacy_import_chunks'), 'import_id', importIds, 'legacy_import_chunks → legacy_imports', errors, false);
  for (const table of BACKUP_TABLES.filter((name) => name !== 'legacy_imports' && name !== 'legacy_import_chunks')) {
    checkReferences(rows(tables, table), 'source_import_id', importIds, `${table} → legacy_imports`, errors, true);
  }
}

function checkReferences(source: JsonRow[], column: string, targets: Set<string>, label: string, errors: string[], nullable: boolean) {
  const missing = source.filter((row) => {
    const value = text(row[column]);
    return value ? !targets.has(value) : !nullable;
  }).length;
  if (missing) errors.push(`Порушено зв’язок ${label}: ${missing} запис(и).`);
}

function rows(tables: JsonRow, table: BackupTable): JsonRow[] {
  return Array.isArray(tables[table]) ? (tables[table] as unknown[]).filter(isRow) : [];
}
function emptyInspection(errors: string[]): CloudBackupInspection {
  return { valid: false, schemaVersion: null, createdAt: null, ownerEmail: null, ownerId: null, revision: null, totalRecords: 0, counts: { ...EMPTY_COUNTS }, errors, warnings: [] };
}
function record(value: unknown): JsonRow | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRow : null; }
function isRow(value: unknown): value is JsonRow { return Boolean(record(value)); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) ? value : null; }
