import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { backupManifest } from '@/lib/backups/export';
import { CLOUD_BACKUP_MAX_BYTES, cloudBackupSha256, inspectCloudBackup } from '@/lib/backups/inspect';
import { readBoundedText } from '@/lib/http-body';

const REQUEST_MAX_BYTES = Math.ceil(CLOUD_BACKUP_MAX_BYTES * 1.35);

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const requestText = await readBoundedText(
    request,
    REQUEST_MAX_BYTES,
    'Файл завеликий. Максимальний розмір — 25 МБ.',
  );
  if (requestText instanceof Response) return requestText;
  let rawBackup = '';
  try {
    const body = JSON.parse(requestText) as { rawBackup?: unknown };
    rawBackup = typeof body.rawBackup === 'string' ? body.rawBackup : '';
  } catch {
    return Response.json({ error: 'Не вдалося прочитати запит.' }, { status: 400 });
  }
  if (!rawBackup) return Response.json({ error: 'Резервну копію не передано.' }, { status: 400 });
  if (new TextEncoder().encode(rawBackup).byteLength > CLOUD_BACKUP_MAX_BYTES) return tooLarge();
  const inspection = inspectCloudBackup(rawBackup);
  if (!inspection.valid) return Response.json({ error: inspection.errors[0], inspection }, { status: 400 });
  if (inspection.ownerEmail?.toLowerCase() !== user.email.toLowerCase()) {
    return Response.json({ error: 'Ця копія належить іншому обліковому запису.', inspection }, { status: 403 });
  }
  const current = await backupManifest(env.DB, user.id);
  const comparison = Object.fromEntries(Object.entries(inspection.counts).map(([table, backup]) => [table, { backup, current: current.counts[table] || 0, difference: backup - (current.counts[table] || 0) }]));
  return Response.json({
    ok: true,
    sha256: await cloudBackupSha256(rawBackup),
    inspection,
    currentRevision: current.revision,
    comparison,
    dataChanged: current.revision !== inspection.revision,
    mode: 'preview-only',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
function tooLarge(): Response { return Response.json({ error: 'Файл завеликий. Максимальний розмір — 25 МБ.' }, { status: 413 }); }
