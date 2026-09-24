import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

import { BACKUP_TABLES as TABLES, type BackupTable, backupManifest, backupPage, BackupConflict } from '@/lib/backups/export';
import { CLOUD_BACKUP_APP, CLOUD_BACKUP_SCHEMA_VERSION } from '@/lib/backups/inspect';

const BACKUP_RECEIPT_MAX_BYTES = 64 * 1024;

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const table = url.searchParams.get('table');
  if (!table) return manifest(user.id, user.email);
  if (!TABLES.includes(table as BackupTable)) return Response.json({ error: 'Невідомий розділ резервної копії.' }, { status: 400 });

  const revision = Number(url.searchParams.get('revision'));
  if (!url.searchParams.has('revision') || !Number.isSafeInteger(revision) || revision < 0) return Response.json({ error: 'Потрібна версія резервної копії.' }, { status: 400 });
  try {
    return Response.json(await backupPage(env.DB,user.id,table as BackupTable,url.searchParams.get('cursor') || '',revision), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof BackupConflict) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, BACKUP_RECEIPT_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed;
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
  const byteSize = Number(body.byteSize);
  const revision = Number(body.revision);
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(byteSize) || byteSize <= 0 || !Number.isSafeInteger(revision) || revision < 0 || !body.counts || typeof body.counts !== 'object') {
    return Response.json({ error: 'Некоректні дані резервної копії.' }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const current = await backupManifest(env.DB,user.id);
  if (current.revision !== revision) return Response.json({ error: 'Дані змінилися до підтвердження копії. Створи її ще раз.' }, { status: 409 });
  await env.DB.prepare(`INSERT INTO backup_exports (id,user_id,sha256,byte_size,record_counts_json,created_at,revision) VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(id,user.id,sha256,byteSize,JSON.stringify(body.counts),createdAt,revision).run();
  return Response.json({ ok: true, id, createdAt });
}

async function manifest(userId: string, email: string): Promise<Response> {
  const { counts, revision } = await backupManifest(env.DB,userId);
  const last = await env.DB.prepare(`SELECT sha256,byte_size,record_counts_json,created_at FROM backup_exports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`).bind(userId).first();
  return Response.json({
    app: CLOUD_BACKUP_APP, schemaVersion: CLOUD_BACKUP_SCHEMA_VERSION, ownerEmail: email, ownerId: userId, revision,
    createdAt: new Date().toISOString(), tables: TABLES, counts, lastBackup: last || null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
