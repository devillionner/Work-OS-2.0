import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readBoundedMultipartForm } from '@/lib/http-form';
import { sameOrigin } from '@/lib/http-json';
import { adImageSettingKey } from '@/lib/autopost-ads';
import { MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES, readStoredImage, saveStoredImage } from '@/lib/whatsapp-autopost-media';

const MAX_MULTIPART_BYTES = MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES + 512 * 1024;
const idOf = (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : '');

/** Чи це оголошення власника (фото бувають лише в оголошень). */
async function ownsAdvertisement(userId: string, id: string) {
  const row = await env.DB.prepare(`SELECT 1 AS hit FROM library_items WHERE id=?1 AND user_id=?2 AND collection='advertisement' LIMIT 1`).bind(id, userId).first<{ hit: number }>();
  return Boolean(row);
}

// Фото оголошення Бібліотеки (3.20.0): лежить у `user_settings` так само, як фото автопосту; у `library_items.image_key` лише його SHA-256 (ознака «є фото» й ключ кешу).
// Зміна фото версію оголошення не піднімає: задачі в черзі не втрачають чинність.
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  const id = idOf(new URL(request.url).searchParams.get('id'));
  if (!id) return new Response(null, { status: 404 });
  const image = await readStoredImage(env.DB, user.id, adImageSettingKey(id), true);
  if (!image) return new Response(null, { status: 404 });
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Response(bytes, { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсне джерело запиту.' }, { status: 403 });
  try {
    const form = await readBoundedMultipartForm(request, MAX_MULTIPART_BYTES);
    if (form instanceof Response) return form;
    const id = idOf(form.get('id'));
    const file = form.get('file');
    if (!id || !(file instanceof File)) return Response.json({ error: 'Оберіть оголошення й фото.' }, { status: 400 });
    if (!(await ownsAdvertisement(user.id, id))) return Response.json({ error: 'Оголошення не знайдено.' }, { status: 404 });
    const image = await saveStoredImage(env.DB, user.id, adImageSettingKey(id), { fileName: file.name, contentType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) }, Math.floor(Date.now() / 1000));
    await env.DB.prepare(`UPDATE library_items SET image_key=?1 WHERE id=?2 AND user_id=?3`).bind(image.sha256, id, user.id).run();
    return Response.json({ ok: true, imageKey: image.sha256 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Не вдалося зберегти фото оголошення.' }, { status: 400 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсне джерело запиту.' }, { status: 403 });
  const id = idOf(new URL(request.url).searchParams.get('id'));
  if (!id || !(await ownsAdvertisement(user.id, id))) return Response.json({ error: 'Оголошення не знайдено.' }, { status: 404 });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM user_settings WHERE user_id=?1 AND setting_key=?2`).bind(user.id, adImageSettingKey(id)),
    env.DB.prepare(`UPDATE library_items SET image_key=NULL WHERE id=?1 AND user_id=?2`).bind(id, user.id),
  ]);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
