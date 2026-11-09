import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { authenticateDiscoveryExecutor } from '@/lib/chat-discovery/executor-auth';
import { BACKUP_MAX_BYTES, BACKUP_PART_MAX_BYTES, BACKUP_PART_SIZE, backupObjectKey, cleanBackupId, readRunnerBackups, registerRunnerBackup, removeRunnerBackup } from '@/lib/runner-transfer';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Власник сторінки (сесія) або runner (токен executor): архів належить тому самому власнику. */
async function owner(request: Request): Promise<{ userId: string; viaRunner: boolean } | null> {
  if ((request.headers.get('Authorization') || '').startsWith('Bearer ')) {
    try { return { userId: (await authenticateDiscoveryExecutor(env.DB, request, Math.floor(Date.now() / 1000))).userId, viaRunner: true }; } catch { return null; }
  }
  const user = await getCurrentUser();
  return user ? { userId: user.id, viaRunner: false } : null;
}

/** Список архівів і завантаження частини (`?download=<id>&part=<n>`: частина віддається потоком із R2, без читання в пам'ять). */
export async function GET(request: Request): Promise<Response> {
  const who = await owner(request);
  if (!who) return json({ error: 'Потрібна авторизація.' }, 401);
  const url = new URL(request.url);
  const backups = await readRunnerBackups(env.DB, who.userId);
  const download = cleanBackupId(url.searchParams.get('download'));
  if (!download) return json({ backups, available: Boolean(env.FILES) });
  if (!env.FILES) return json({ error: 'Сховище не підключено.' }, 501);
  const meta = backups.find((item) => item.id === download);
  const part = Number(url.searchParams.get('part'));
  if (!meta || !Number.isInteger(part) || part < 1 || part > meta.parts) return json({ error: 'Архів або частину не знайдено.' }, 404);
  const offset = (part - 1) * meta.partSize;
  const length = Math.min(meta.partSize, meta.sizeBytes - offset);
  const object = await env.FILES.get(backupObjectKey(who.userId, meta.id), { range: { offset, length } });
  if (!object) return json({ error: 'Архів у хмарі не знайдено.' }, 404);
  return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length), 'Cache-Control': 'no-store' } });
}

/** Вивантаження частини: `PUT ?id=&uploadId=&part=` з тілом-байтами (довжина обов'язкова). */
export async function PUT(request: Request): Promise<Response> {
  const who = await owner(request);
  if (!who?.viaRunner) return json({ error: 'Потрібен токен runner.' }, 401);
  if (!env.FILES) return json({ error: 'Сховище не підключено.' }, 501);
  const url = new URL(request.url);
  const id = cleanBackupId(url.searchParams.get('id'));
  const uploadId = url.searchParams.get('uploadId') || '';
  const part = Number(url.searchParams.get('part'));
  const length = Number(request.headers.get('Content-Length'));
  if (!id || !uploadId || !Number.isInteger(part) || part < 1 || part > 10000 || !request.body) return json({ error: 'Некоректна частина.' }, 400);
  if (!Number.isFinite(length) || length < 1 || length > BACKUP_PART_MAX_BYTES) return json({ error: 'Частина має бути до 50 МБ.' }, 413);
  try {
    const upload = env.FILES.resumeMultipartUpload(backupObjectKey(who.userId, id), uploadId);
    const uploaded = await upload.uploadPart(part, request.body);
    return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  } catch (error) {
    console.error('Runner backup part failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Частину не вивантажено: повтор.' }, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const who = await owner(request);
  if (!who) return json({ error: 'Потрібна авторизація.' }, 401);
  if (!who.viaRunner && !sameOrigin(request)) return json({ error: 'Недійсне джерело запиту.' }, 403);
  const body = await readJsonObject(request, 64 * 1024);
  if (body instanceof Response) return body;
  if (!env.FILES) return json({ error: 'Сховище для архіву не підключено на цьому середовищі.' }, 501);
  const now = Math.floor(Date.now() / 1000);
  try {
    if (body.action === 'delete') {
      if (who.viaRunner) return json({ error: 'Видаляє лише власник зі сторінки.' }, 403);
      const id = cleanBackupId(body.id);
      if (!id) return json({ error: 'Архів не вказано.' }, 400);
      return json({ backups: await removeRunnerBackup(env.DB, env.FILES, who.userId, id, now) });
    }
    if (!who.viaRunner) return json({ error: 'Потрібен токен runner.' }, 401);
    if (body.action === 'start') {
      const sizeBytes = Number(body.sizeBytes);
      if (!Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > BACKUP_MAX_BYTES) return json({ error: 'Архів завеликий (до 8 ГБ).' }, 413);
      const id = crypto.randomUUID();
      const upload = await env.FILES.createMultipartUpload(backupObjectKey(who.userId, id));
      return json({ id, uploadId: upload.uploadId, partSize: BACKUP_PART_SIZE });
    }
    const id = cleanBackupId(body.id);
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!id || !uploadId) return json({ error: 'Некоректний запит.' }, 400);
    const upload = env.FILES.resumeMultipartUpload(backupObjectKey(who.userId, id), uploadId);
    if (body.action === 'abort') { await upload.abort().catch(() => undefined); return json({ ok: true }); }
    if (body.action === 'complete') {
      const parts = Array.isArray(body.parts) ? body.parts.map((item) => ({ partNumber: Number((item as { partNumber?: unknown }).partNumber), etag: String((item as { etag?: unknown }).etag || '') })) : [];
      const sizeBytes = Number(body.sizeBytes);
      if (!parts.length || parts.some((part) => !Number.isInteger(part.partNumber) || !part.etag) || !Number.isFinite(sizeBytes) || sizeBytes < 1) return json({ error: 'Некоректний перелік частин.' }, 400);
      const sha256 = typeof body.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : '';
      if (!sha256) return json({ error: 'Потрібна контрольна сума.' }, 400);
      const object = await upload.complete(parts.sort((a, b) => a.partNumber - b.partNumber));
      if (object.size !== sizeBytes) { await env.FILES.delete(backupObjectKey(who.userId, id)).catch(() => undefined); return json({ error: 'Розмір архіву в хмарі не збігається: вивантаж ще раз.' }, 409); }
      const backups = await registerRunnerBackup(env.DB, env.FILES, who.userId, {
        id, createdAt: now, sizeBytes, sha256, version: typeof body.version === 'string' ? body.version.slice(0, 20) : '', partSize: BACKUP_PART_SIZE, parts: parts.length,
        host: typeof body.host === 'string' ? body.host.slice(0, 50) : '',
      }, now);
      return json({ backups });
    }
    return json({ error: 'Невідома дія.' }, 400);
  } catch (error) {
    console.error('Runner backup action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Дію з архівом не виконано.' }, 500);
  }
}
