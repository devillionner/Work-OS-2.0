import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/http-json';
import { PHOTO_MAX_BYTES, photoPrefix } from '@/lib/dev-items';

const TYPES: Record<string, { ext: string; magic: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
};
const unavailable = () => Response.json({ error: 'Сховище файлів не підключено в цьому середовищі.' }, { status: 503 });

/** Фото запису: клієнт уже стиснув його; тут лише перевірка типу, розміру й запис у R2 під ключем власника. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  if (!env.FILES) return unavailable();
  const type = TYPES[(request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()];
  if (!type) return Response.json({ error: 'Підтримуються лише зображення JPEG, PNG і WebP.' }, { status: 415 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > PHOTO_MAX_BYTES) return Response.json({ error: 'Фото завелике.' }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > PHOTO_MAX_BYTES) return Response.json({ error: bytes.length ? 'Фото завелике.' : 'Файл порожній.' }, { status: bytes.length ? 413 : 400 });
  if (!type.magic(bytes)) return Response.json({ error: 'Файл не схожий на зображення.' }, { status: 415 });
  const key = `${photoPrefix(user.id)}${crypto.randomUUID()}.${type.ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: request.headers.get('content-type')!.split(';', 1)[0].trim().toLowerCase() } });
  return Response.json({ ok: true, key, bytes: bytes.length });
}

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!env.FILES) return unavailable();
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith(photoPrefix(user.id)) || key.length > 200 || !/^[\w./-]+$/.test(key) || key.includes('..')) return Response.json({ error: 'Файл не знайдено.' }, { status: 404 });
  const object = await env.FILES.get(key);
  if (!object) return Response.json({ error: 'Файл не знайдено.' }, { status: 404 });
  return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

/** Прибирає завантажене фото, яке так і не потрапило в запис (скасована правка). Лише власні ключі. */
export async function DELETE(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  if (!env.FILES) return unavailable();
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith(photoPrefix(user.id)) || key.length > 200 || !/^[\w./-]+$/.test(key) || key.includes('..')) return Response.json({ error: 'Файл не знайдено.' }, { status: 404 });
  // Фото, що вже є в якомусь записі, не видаляється: його прибере збереження запису.
  const used = await env.DB.prepare('SELECT 1 AS used FROM dev_items WHERE user_id=?1 AND instr(photos_json,?2)>0 LIMIT 1').bind(user.id, key).first();
  if (used) return Response.json({ ok: true, kept: true });
  await env.FILES.delete(key);
  return Response.json({ ok: true });
}
