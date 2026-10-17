import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { matchRevisionJson, putRevisionJson, revisionCacheRequest } from '@/lib/revision-cache';

type ChatRow = { id: string; name: string; platform: string; workflow_status: string; link: string };

/**
 * Усі чати власника в стислому вигляді для поля «Чат-джерело» ліда: пошук іде в браузері, тож один запит на сесію
 * (кеш за ревізією даних і клієнтський кеш), а не запит на кожну літеру.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const cacheRequest = await revisionCacheRequest(env.DB, user.id, 'lead-chat-options', 'v1');
  const cached = await matchRevisionJson(cacheRequest);
  if (cached) return cached;
  const rows = await env.DB.prepare('SELECT id,name,platform,workflow_status,link FROM chats WHERE user_id=?1 LIMIT 8000')
    .bind(user.id).all<ChatRow>();
  const payload = { chats: rows.results.map((row) => ({ id: row.id, name: row.name, platform: row.platform, status: row.workflow_status, link: row.link })) };
  await putRevisionJson(cacheRequest, payload, 300);
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store', 'X-Work-OS-Cache': 'MISS' } });
}
