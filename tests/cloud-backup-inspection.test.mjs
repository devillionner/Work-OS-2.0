import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { BACKUP_TABLES } from '../lib/backups/export.ts';
import { CLOUD_BACKUP_SCHEMA_VERSION, cloudBackupSha256, inspectCloudBackup } from '../lib/backups/inspect.ts';
import { restoreMissingChunk } from '../lib/backups/restore.ts';

function backup(overrides = {}) {
  const tables = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
  Object.assign(tables, overrides);
  return JSON.stringify({
    app: 'work-os-cloud-backup', schemaVersion: CLOUD_BACKUP_SCHEMA_VERSION, createdAt: '2026-09-10T10:00:00.000Z',
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
    lead_messages: [{ id: 'message-1', user_id: 'owner', lead_id: 'lead-1' }],
    lead_message_attachments: [{ id: 'attachment-1', user_id: 'owner', lead_id: 'lead-1', message_id: 'message-1' }],
    lead_message_attachment_chunks: [{ id: 'chunk-1', user_id: 'owner', attachment_id: 'attachment-1' }],
  }));
  assert.equal(result.valid, true, result.errors.join('\n'));
});

void test('rejects orphaned CRM media metadata and chunks', () => {
  const orphanMessage = inspectCloudBackup(backup({
    leads: [{ id: 'lead-1', user_id: 'owner', source_import_id: null }],
    lead_message_attachments: [{ id: 'attachment-1', user_id: 'owner', lead_id: 'lead-1', message_id: 'missing-message' }],
  }));
  assert.equal(orphanMessage.valid, false);
  assert.match(orphanMessage.errors.join('\n'), /lead_message_attachments → lead_messages/);

  const orphanChunk = inspectCloudBackup(backup({
    lead_message_attachment_chunks: [{ id: 'chunk-1', user_id: 'owner', attachment_id: 'missing-attachment' }],
  }));
  assert.equal(orphanChunk.valid, false);
  assert.match(orphanChunk.errors.join('\n'), /lead_message_attachment_chunks → lead_message_attachments/);
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

void test('missing-only restore remaps CRM media ownership and preserves attachment links', async (t) => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE leads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE lead_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,lead_id TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE lead_message_attachments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,lead_id TEXT NOT NULL,message_id TEXT NOT NULL,file_name TEXT NOT NULL,content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,chunk_count INTEGER NOT NULL,created_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE lead_message_attachment_chunks(id TEXT PRIMARY KEY,attachment_id TEXT NOT NULL,user_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,data_base64 TEXT NOT NULL)').run();
  await db.prepare("INSERT INTO leads(id,user_id) VALUES('lead-1','current-owner')").run();
  await db.prepare("INSERT INTO lead_messages(id,user_id,lead_id) VALUES('message-1','current-owner','lead-1')").run();

  const metadataPayload = JSON.stringify([{
    id:'attachment-1',user_id:'backup-owner',lead_id:'lead-1',message_id:'message-1',
    file_name:'photo.webp',content_type:'image/webp',size_bytes:3,sha256:'a'.repeat(64),chunk_count:1,created_at:1,
  }]);
  const metadata = await restoreMissingChunk({
    db,
    table:'lead_message_attachments',
    payload:metadataPayload,
    sha256:await cloudBackupSha256(metadataPayload),
    rowCount:1,
    userId:'current-owner',
  });
  assert.equal(metadata.inserted,1);
  assert.equal(await db.prepare("SELECT user_id FROM lead_message_attachments WHERE id='attachment-1'").first('user_id'),'current-owner');

  const chunkPayload = JSON.stringify([{
    id:'attachment-1:0',attachment_id:'attachment-1',user_id:'backup-owner',chunk_index:0,data_base64:'YWJj',
  }]);
  const chunk = await restoreMissingChunk({
    db,
    table:'lead_message_attachment_chunks',
    payload:chunkPayload,
    sha256:await cloudBackupSha256(chunkPayload),
    rowCount:1,
    userId:'current-owner',
  });
  assert.equal(chunk.inserted,1);
  assert.equal(await db.prepare("SELECT user_id FROM lead_message_attachment_chunks WHERE id='attachment-1:0'").first('user_id'),'current-owner');
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

void test('accepts schema 9 backups created before goal history existed', () => {
  const parsed = JSON.parse(backup());
  parsed.schemaVersion = 9;
  delete parsed.tables.goal_versions;
  delete parsed.counts.goal_versions;
  const result = inspectCloudBackup(JSON.stringify(parsed));
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.match(result.warnings.join('\n'), /попередню сумісну схему 9/);
  assert.equal(result.counts.goal_versions, 0);
});
