import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { BACKUP_TABLES, backupManifest, type BackupTable } from '@/lib/backups/export';
import { CLOUD_BACKUP_MAX_BYTES, cloudBackupSha256, inspectCloudBackup } from '@/lib/backups/inspect';

const REQUEST_MAX_BYTES = Math.ceil(CLOUD_BACKUP_MAX_BYTES * 1.35);
const CHUNK_MAX_ROWS = 100;
const CHUNK_MAX_BYTES = 400_000;

type RestoreRow = {
  id: string; original_filename: string; sha256: string; source_schema_version: number;
  source_revision: number; current_revision_at_stage: number; byte_size: number;
  record_counts_json: string; status: string; created_at: number;
};

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const row = await env.DB.prepare(`SELECT id,original_filename,sha256,source_schema_version,source_revision,current_revision_at_stage,byte_size,record_counts_json,status,created_at FROM cloud_restore_imports WHERE user_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(user.id).first<RestoreRow>();
  return Response.json({ staged: row ? describe(row) : null }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > REQUEST_MAX_BYTES) return tooLarge();
  const requestText = await request.text();
  if (new TextEncoder().encode(requestText).byteLength > REQUEST_MAX_BYTES) return tooLarge();
  let body: { filename?: unknown; rawBackup?: unknown; sha256?: unknown };
  try { body = JSON.parse(requestText) as typeof body; } catch { return Response.json({ error: 'Не вдалося прочитати запит.' }, { status: 400 }); }
  const rawBackup = typeof body.rawBackup === 'string' ? body.rawBackup : '';
  if (!rawBackup) return Response.json({ error: 'Резервну копію не передано.' }, { status: 400 });
  const byteSize = new TextEncoder().encode(rawBackup).byteLength;
  if (byteSize > CLOUD_BACKUP_MAX_BYTES) return tooLarge();
  const inspection = inspectCloudBackup(rawBackup);
  if (!inspection.valid || inspection.schemaVersion === null || inspection.revision === null) return Response.json({ error: inspection.errors[0] || 'Копія не пройшла перевірку.' }, { status: 400 });
  if (inspection.ownerEmail?.toLowerCase() !== user.email.toLowerCase()) return Response.json({ error: 'Ця копія належить іншому обліковому запису.' }, { status: 403 });
  const sha256 = await cloudBackupSha256(rawBackup);
  if (typeof body.sha256 === 'string' && body.sha256 !== sha256) return Response.json({ error: 'Файл змінився після перевірки. Вибери його ще раз.' }, { status: 409 });
  const existing = await env.DB.prepare(`SELECT id,original_filename,sha256,source_schema_version,source_revision,current_revision_at_stage,byte_size,record_counts_json,status,created_at FROM cloud_restore_imports WHERE user_id=?1 AND sha256=?2 LIMIT 1`).bind(user.id, sha256).first<RestoreRow>();
  if (existing) return Response.json({ ok: true, duplicate: true, staged: describe(existing) });

  const parsed = JSON.parse(rawBackup) as { tables: Record<BackupTable, Array<Record<string, unknown>>> };
  const current = await backupManifest(env.DB, user.id);
  const importId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const chunkStatements: D1PreparedStatement[] = [];
  for (const table of BACKUP_TABLES) {
    const rows = Array.isArray(parsed.tables[table]) ? parsed.tables[table] : [];
    const chunks = chunkRows(rows);
    for (let index = 0; index < chunks.length; index += 1) {
      const payload = JSON.stringify(chunks[index]);
      chunkStatements.push(env.DB.prepare(`INSERT INTO cloud_restore_chunks(import_id,table_name,chunk_index,payload_json,sha256,row_count) VALUES(?1,?2,?3,?4,?5,?6)`).bind(importId, table, index, payload, await cloudBackupSha256(payload), chunks[index].length));
    }
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cloud_restore_imports(id,user_id,original_filename,sha256,source_schema_version,source_revision,current_revision_at_stage,byte_size,record_counts_json,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'staged',?10,?10)`).bind(importId,user.id,safeFilename(body.filename),sha256,inspection.schemaVersion,inspection.revision,current.revision,byteSize,JSON.stringify(inspection.counts),now),
    ...chunkStatements,
  ]);
  const staged: RestoreRow = { id: importId, original_filename: safeFilename(body.filename), sha256, source_schema_version: inspection.schemaVersion, source_revision: inspection.revision, current_revision_at_stage: current.revision, byte_size: byteSize, record_counts_json: JSON.stringify(inspection.counts), status: 'staged', created_at: now };
  return Response.json({ ok: true, duplicate: false, staged: describe(staged) });
}

function describe(row: RestoreRow) { return { id: row.id, filename: row.original_filename, sha256: row.sha256, schemaVersion: row.source_schema_version, sourceRevision: row.source_revision, currentRevisionAtStage: row.current_revision_at_stage, byteSize: row.byte_size, counts: JSON.parse(row.record_counts_json), status: row.status, createdAt: row.created_at }; }
function chunkRows(rows: Array<Record<string, unknown>>) {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  const encoder = new TextEncoder();
  for (const row of rows) {
    const candidate = [...current, row];
    if (current.length && (current.length >= CHUNK_MAX_ROWS || encoder.encode(JSON.stringify(candidate)).byteLength > CHUNK_MAX_BYTES)) { chunks.push(current); current = [row]; }
    else current = candidate;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
function safeFilename(value: unknown) { const filename = typeof value === 'string' ? value.trim() : ''; return Array.from(filename || 'work-os-backup.json').map((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character; }).join('').slice(0, 180); }
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
function tooLarge() { return Response.json({ error: 'Файл завеликий. Максимальний розмір — 25 МБ.' }, { status: 413 }); }
