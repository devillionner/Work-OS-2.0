import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { confirmResolvedChatName, scanChatNames } from '@/lib/chats/name-enrichment';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const REQUEST_MAX_BYTES = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const now = Math.floor(Date.now() / 1000);

  try {
    if (action === 'scan') {
      const result = await scanChatNames(env.DB, user.id, {
        cursor: typeof body.cursor === 'string' ? body.cursor : null,
        ids: Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === 'string') : undefined,
        limit: Number.isSafeInteger(body.limit) ? Number(body.limit) : undefined,
      }, now);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'confirm') {
      const id = typeof body.id === 'string' ? body.id : '';
      const name = typeof body.name === 'string' ? body.name : '';
      const expectedUpdatedAt = Number(body.expectedUpdatedAt);
      const result = await confirmResolvedChatName(env.DB, user.id, { id, name, expectedUpdatedAt }, now);
      return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: 'Невідома дія перевірки назв.' }, { status: 400 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Не вдалося перевірити назви чатів.';
    const status = /вже змінився|Некоректне підтвердження/.test(message) ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
