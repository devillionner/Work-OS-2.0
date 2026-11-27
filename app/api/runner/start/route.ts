import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/http-json';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * «Запустити runner» з будь-якого пристрою: команда черговому на ПК (scripts/platform/runner-standby.mjs) через live-канал.
 * Без цього маршруту телефон не має як достукатися до ПК: посилання workos-runner:// працює лише на самому ПК.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Потрібна авторизація.' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Недійсне джерело запиту.' }, 403);
  const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(user.id));
  const response = await stub.fetch(new Request(`https://owner-channel/runner-start?userId=${encodeURIComponent(user.id)}`, { method: 'POST' }));
  const result = await response.json().catch(() => ({ delivered: 0 })) as { delivered?: number; runnerConnected?: boolean };
  return json({ delivered: Number(result.delivered) || 0, runnerConnected: Boolean(result.runnerConnected) });
}
