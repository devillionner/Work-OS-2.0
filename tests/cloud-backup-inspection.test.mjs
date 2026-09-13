import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { BACKUP_TABLES } from '../lib/backups/export.ts';
import { cloudBackupSha256, inspectCloudBackup } from '../lib/backups/inspect.ts';
import { restoreMissingChunk } from '../lib/backups/restore.ts';

function backup(overrides = {}) {
  const tables = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
  Object.assign(tables, overrides);
  return JSON.stringify({
    app: 'work-os-cloud-backup', schemaVersion: 8, createdAt: '2026-09-10T10:00:00.000Z',
    ownerEmail: 'owner@example.com', ownerId: 'owner', revision: 42,
    counts: Object.fromEntries(BACKUP_TABLES.map((table) => [table, tables[table].length])),
    tables,
  });
}

void test('accepts a complete empty Work OS backup', () => {
  const result = inspectCloudBackup(backup());
  assert.equal(result.valid, true);
  assert.equal(result.totalRecords, 0);
  assert.deepEqual(result.errors, []);
});

void test('rejects mismatched declared counts', () => {
  const parsed = JSON.parse(backup());
  parsed.counts.chats = 1;
  const result = inspectCloudBackup(JSON.stringify(parsed));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Контрольна кількість.*chats/);
});

void test('accepts schema 7 backups created before workdays existed', () => {
  const parsed = JSON.parse(backup());
  parsed.schemaVersion = 7;
  delete parsed.tables.workdays;
  delete parsed.counts.workdays;
  const result = inspectCloudBackup(JSON.stringify(parsed));
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.match(result.warnings.join('\n'), /попередню сумісну схему 7/);
  assert.equal(result.counts.workdays, 0);
});

void test('accepts schema 6 backups created before Telegram scheduler tables existed', () => {
  const parsed = JSON.parse(backup());
  parsed.schemaVersion = 6;
  delete parsed.tables.telegram_schedule_settings;
  delete parsed.tables.telegram_schedule_slots;
  delete parsed.counts.telegram_schedule_settings;
  delete parsed.counts.telegram_schedule_slots;
  delete parsed.tables.workdays;
  delete parsed.counts.workdays;
  const result = inspectCloudBackup(JSON.stringify(parsed));
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.match(result.warnings.join('\n'), /попередню сумісну схему 6/);
  assert.equal(result.counts.telegram_schedule_settings, 0);
  assert.equal(result.counts.telegram_schedule_slots, 0);
});
void test('accepts schema 5 backups created before the library section existed', () => {
  const parsed = JSON.parse(backup());
  parsed.schemaVersion = 5;
  delete parsed.tables.library_items;
  delete parsed.counts.library_items;
  const result = inspectCloudBackup(JSON.stringify(parsed));
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.match(result.warnings.join('\n'), /попередню сумісну схему 5/);
  assert.equal(result.counts.library_items, 0);
});

void test('rejects mixed-owner rows and duplicate primary keys', () => {
  const row = { id: 'chat-1', user_id: 'someone-else' };
  const result = inspectCloudBackup(backup({ chats: [row, row] }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /дублюється ключ/);
  assert.match(result.errors.join('\n'), /іншого власника/);
});

void test('rejects broken foreign-key relationships', () => {
  const result = inspectCloudBackup(backup({ chat_profiles: [{ chat_id: 'missing-chat' }] }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /chat_profiles → chats/);
});

void test('accepts internally consistent linked rows', () => {
  const result = inspectCloudBackup(backup({
    chats: [{ id: 'chat-1', user_id: 'owner', source_import_id: null, telegram_account_id: null }],
    chat_profiles: [{ chat_id: 'chat-1' }],
    leads: [{ id: 'lead-1', user_id: 'owner', source_import_id: null }],
    students: [{ id: 'student-1', user_id: 'owner', lead_id: 'lead-1', source_import_id: null }],
    lessons: [{ id: 'lesson-1', user_id: 'owner', lead_id: 'lead-1', student_id: 'student-1', source_import_id: null }],
    lesson_reminders: [{ id: 'reminder-1', user_id: 'owner', lesson_id: 'lesson-1', source_import_id: null }],
  }));
  assert.equal(result.valid, true, result.errors.join('\n'));
});

void test('missing-only restore remaps ownership and never overwrites an existing row', async (t) => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL)').run();
  const firstPayload = JSON.stringify([{ id: 'chat-1', user_id: 'backup-owner', name: 'Recovered' }]);
  const first = await restoreMissingChunk({ db, table: 'chats', payload: firstPayload, sha256: await cloudBackupSha256(firstPayload), rowCount: 1, userId: 'current-owner' });
  assert.equal(first.inserted, 1);
  assert.deepEqual(await db.prepare('SELECT user_id,name FROM chats WHERE id=?1').bind('chat-1').first(), { user_id: 'current-owner', name: 'Recovered' });
  await db.prepare('UPDATE chats SET name=?1 WHERE id=?2').bind('Current value', 'chat-1').run();
  const repeated = await restoreMissingChunk({ db, table: 'chats', payload: firstPayload, sha256: await cloudBackupSha256(firstPayload), rowCount: 1, userId: 'current-owner' });
  assert.equal(repeated.inserted, 0);
  assert.equal(await db.prepare('SELECT name FROM chats WHERE id=?1').bind('chat-1').first('name'), 'Current value');
});

void test('restore rejects a tampered staging chunk before writing', async (t) => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL)').run();
  const payload = JSON.stringify([{ id: 'chat-1', user_id: 'owner', name: 'Recovered' }]);
  await assert.rejects(restoreMissingChunk({ db, table: 'chats', payload, sha256: '0'.repeat(64), rowCount: 1, userId: 'owner' }), /Контрольна сума/);
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM chats').first('count'), 0);
});

void test('restore rejects an id collision owned by another account', async (t) => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL)').run();
  await db.prepare("INSERT INTO chats(id,user_id,name) VALUES('chat-1','other-owner','Private')").run();
  const payload = JSON.stringify([{ id: 'chat-1', user_id: 'backup-owner', name: 'Recovered' }]);
  await assert.rejects(restoreMissingChunk({ db, table: 'chats', payload, sha256: await cloudBackupSha256(payload), rowCount: 1, userId: 'current-owner' }), /іншим власником/);
  assert.deepEqual(await db.prepare('SELECT user_id,name FROM chats WHERE id=?1').bind('chat-1').first(), { user_id: 'other-owner', name: 'Private' });
});
