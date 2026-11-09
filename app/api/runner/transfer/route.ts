import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** «Зберегти для перенесення» / «Скасувати»: лише команда runner через live-канал; пароль, архів і прогрес до цього маршруту не доходять. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Недійсне джерело запиту.' }, 403);
  const body = await readJsonObject(request, 1024);
  if (body instanceof Response) return body;
  if (!env.FILES) return json({ error: 'Сховище для архіву не підключено на цьому середовищі.' }, 501);
  const action = body.action === 'cancel' ? 'cancel' : 'backup';
  const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(user.id));
  const response = await stub.fetch(new Request(`https://owner-channel/runner-transfer?userId=${encodeURIComponent(user.id)}&action=${action}`, { method: 'POST' }));
  const result = await response.json().catch(() => ({ delivered: 0 })) as { delivered?: number };
  if (!result.delivered) return json({ error: 'Runner зараз не підключений: запусти його на цьому ПК і повтори.' }, 409);
  return json({ ok: true });
}
