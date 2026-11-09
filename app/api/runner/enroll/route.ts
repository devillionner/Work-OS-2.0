import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { createDiscoveryExecutorDevice } from '@/lib/chat-discovery/executor-auth';
import { ENROLL_CODE_TTL_SECONDS, generateEnrollCode, hashEnrollCode, normalizeEnrollCode, readRunnerBackups } from '@/lib/runner-transfer';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
// Реєстр кодів — окремий екземпляр Durable Object (без D1); код і токен не логуються ніде.
const registry = () => env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName('runner-enroll'));

/**
 * Дві дії. `create` — сесія власника: одноразовий код встановлення на 15 хв (зберігається лише хеш).
 * `redeem` — без сесії, бо чиста система її не має: код обмінюється на токен runner (прив'язка без входу вручну) і показує, чи є архів у хмарі.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request, 4 * 1024);
  if (body instanceof Response) return body;
  const now = Math.floor(Date.now() / 1000);
  try {
    if (body.action === 'create') {
      const user = await getCurrentUser();
      if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
      if (!sameOrigin(request)) return json({ error: 'Недійсне джерело запиту.' }, 403);
      const code = generateEnrollCode();
      const expiresAt = now + ENROLL_CODE_TTL_SECONDS;
      const put = await registry().fetch(new Request('https://owner-channel/enroll-put', { method: 'POST', body: JSON.stringify({ hash: await hashEnrollCode(code), userId: user.id, expiresAt }) }));
      if (put.status !== 204) return json({ error: 'Не вдалося створити код.' }, 500);
      return json({ code, expiresAt });
    }
    if (body.action === 'redeem') {
      const code = normalizeEnrollCode(body.code);
      if (code.length !== 8) return json({ error: 'Код має вигляд XXXX-XXXX.' }, 400);
      const take = await registry().fetch(new Request('https://owner-channel/enroll-take', { method: 'POST', body: JSON.stringify({ hash: await hashEnrollCode(code) }) }));
      if (take.status === 429) return json({ error: 'Забагато невдалих спроб: зачекай 15 хвилин і створи новий код.' }, 429);
      if (take.status !== 200) return json({ error: 'Код недійсний, прострочений або вже використаний. Створи новий у «Налаштування → Сервіс → Runner на цьому ПК».' }, 404);
      const { userId } = await take.json() as { userId: string };
      const host = typeof body.host === 'string' ? body.host.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 50) : '';
      const { device, token } = await createDiscoveryExecutorDevice(env.DB, userId, host ? `Runner ${host}` : 'Runner', now);
      const backups = await readRunnerBackups(env.DB, userId);
      return json({ token, deviceId: device.id, backup: backups[0] ?? null });
    }
    return json({ error: 'Невідома дія.' }, 400);
  } catch (error) {
    console.error('Runner enroll failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося обробити код.' }, 500);
  }
}
