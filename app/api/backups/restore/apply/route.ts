import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { backupManifest, type BackupTable } from '@/lib/backups/export';
import { RESTORE_TABLES, restoreMissingChunk } from '@/lib/backups/restore';

type ImportRow = { id: string; status: string; created_at: number };
type JobRow = { id:string; import_id:string; status:'running'|'completed'|'failed'; phase:string; cursor:number; total_chunks:number; processed_chunks:number; error_message:string|null; created_at:number; updated_at:number; completed_at:number|null };
type ChunkRow = { table_name: BackupTable; chunk_index: number; payload_json: string; sha256: string; row_count: number };

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const importId = new URL(request.url).searchParams.get('importId');
  const imported = importId ? await findImport(importId, user.id) : null;
  if (!imported) return Response.json({ job: null, gate: null });
  return Response.json({ job: describeJob(await findJob(imported.id, user.id)), gate: await restoreGate(imported, user.id) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { action?: unknown; importId?: unknown };
  if (body.action === 'start' && typeof body.importId === 'string') return start(body.importId, user.id);
  if (body.action === 'process' && typeof body.importId === 'string') return process(body.importId, user.id);
  return Response.json({ error: 'Невідома дія.' }, { status: 400 });
}

async function start(importId: string, userId: string) {
  const imported = await findImport(importId, userId);
  if (!imported) return Response.json({ error: 'Staging-копію не знайдено.' }, { status: 404 });
  const gate = await restoreGate(imported, userId);
  if (!gate.ready) return Response.json({ error: 'Спочатку створи нову контрольну копію поточної бази.', code: 'backup_required', gate }, { status: 409 });
  const existing = await findJob(importId, userId);
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    if (existing.status !== 'completed') await env.DB.batch([
      env.DB.prepare(`UPDATE cloud_restore_jobs SET status='running',error_message=NULL,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,existing.id,userId),
      env.DB.prepare(`UPDATE cloud_restore_imports SET status='restoring',updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,importId,userId),
    ]);
    return Response.json({ job: describeJob({ ...existing, status: existing.status === 'completed' ? 'completed' : 'running', error_message: null }) });
  }
  const total = Number((await env.DB.prepare(`SELECT COUNT(*) count FROM cloud_restore_chunks WHERE import_id=?1`).bind(importId).first<{count:number}>())?.count || 0);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cloud_restore_jobs(id,user_id,import_id,status,phase,cursor,total_chunks,processed_chunks,created_at,updated_at) VALUES(?1,?2,?3,'running',?4,0,?5,0,?6,?6)`).bind(id,userId,importId,RESTORE_TABLES[0],total,now),
    env.DB.prepare(`UPDATE cloud_restore_imports SET status='restoring',updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,importId,userId),
  ]);
  return Response.json({ job: describeJob({ id,import_id:importId,status:'running',phase:RESTORE_TABLES[0],cursor:0,total_chunks:total,processed_chunks:0,error_message:null,created_at:now,updated_at:now,completed_at:null }) });
}

async function process(importId: string, userId: string) {
  const job = await findJob(importId, userId);
  if (!job) return Response.json({ error: 'Відновлення не розпочато.' }, { status: 404 });
  if (job.status === 'completed') return Response.json({ job: describeJob(job) });
  if (job.status !== 'running') return Response.json({ error: job.error_message || 'Відновлення призупинене.', job: describeJob(job) }, { status: 409 });
  try {
    const next = await nextChunk(job);
    if (!next) return complete(job, userId);
    await restoreMissingChunk({ db: env.DB, table: next.table_name, payload: next.payload_json, sha256: next.sha256, rowCount: next.row_count, userId });
    const now = Math.floor(Date.now() / 1000);
    const nextCursor = next.chunk_index + 1;
    await env.DB.prepare(`UPDATE cloud_restore_jobs SET phase=?1,cursor=?2,processed_chunks=processed_chunks+1,updated_at=?3 WHERE id=?4 AND user_id=?5`).bind(next.table_name,nextCursor,now,job.id,userId).run();
    return Response.json({ job: describeJob({ ...job, phase: next.table_name, cursor: nextCursor, processed_chunks: job.processed_chunks + 1, updated_at: now }) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Невідома помилка відновлення.';
    await env.DB.prepare(`UPDATE cloud_restore_jobs SET status='failed',error_message=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(message.slice(0,500),Math.floor(Date.now()/1000),job.id,userId).run();
    return Response.json({ error: message }, { status: 500 });
  }
}

async function nextChunk(job: JobRow): Promise<ChunkRow | null> {
  const start = Math.max(0, RESTORE_TABLES.indexOf(job.phase as BackupTable));
  for (let index = start; index < RESTORE_TABLES.length; index += 1) {
    const table = RESTORE_TABLES[index];
    const cursor = index === start ? job.cursor : 0;
    const chunk = await env.DB.prepare(`SELECT table_name,chunk_index,payload_json,sha256,row_count FROM cloud_restore_chunks WHERE import_id=?1 AND table_name=?2 AND chunk_index>=?3 ORDER BY chunk_index LIMIT 1`).bind(job.import_id,table,cursor).first<ChunkRow>();
    if (chunk) return chunk;
  }
  return null;
}

async function complete(job: JobRow, userId: string) {
  const now = Math.floor(Date.now()/1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE cloud_restore_jobs SET status='completed',phase='done',processed_chunks=total_chunks,completed_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,job.id,userId),
    env.DB.prepare(`UPDATE cloud_restore_imports SET status='completed',updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,job.import_id,userId),
  ]);
  return Response.json({ job: describeJob({ ...job,status:'completed',phase:'done',processed_chunks:job.total_chunks,completed_at:now,updated_at:now }) });
}

async function restoreGate(imported: ImportRow, userId: string) {
  const current = await backupManifest(env.DB,userId);
  const last = await env.DB.prepare(`SELECT revision,created_at FROM backup_exports WHERE user_id=?1 AND revision IS NOT NULL ORDER BY created_at DESC LIMIT 1`).bind(userId).first<{revision:number;created_at:number}>();
  const ready = Boolean(last && last.revision === current.revision && last.created_at >= imported.created_at);
  return { ready, currentRevision: current.revision, backupRevision: last?.revision ?? null, backupCreatedAt: last?.created_at ?? null };
}
async function findImport(id:string,userId:string) { return env.DB.prepare(`SELECT id,status,created_at FROM cloud_restore_imports WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(id,userId).first<ImportRow>(); }
async function findJob(importId:string,userId:string) { return env.DB.prepare(`SELECT id,import_id,status,phase,cursor,total_chunks,processed_chunks,error_message,created_at,updated_at,completed_at FROM cloud_restore_jobs WHERE import_id=?1 AND user_id=?2 LIMIT 1`).bind(importId,userId).first<JobRow>(); }
function describeJob(job:JobRow|null) { return job ? { id:job.id,importId:job.import_id,status:job.status,phase:job.phase,total:job.total_chunks,complete:job.processed_chunks,percent:job.total_chunks ? Math.round(job.processed_chunks/job.total_chunks*100) : 100,error:job.error_message,completedAt:job.completed_at } : null; }
function sameOrigin(request:Request) { const origin=request.headers.get('origin'); return Boolean(origin&&origin===new URL(request.url).origin); }
