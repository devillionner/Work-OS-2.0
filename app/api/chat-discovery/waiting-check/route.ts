import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Batch/process state now lives in the owner's Durable Object (workers/owner-channel.js), not D1 —
// this route is a thin authenticated HTTP bridge to it. A plain fetch rather than a WebSocket
// upgrade: a one-off status read or start/stop command does not need a held-open connection (the
// runner's side of the protocol does, and uses /api/live for that instead).
async function callOwnerChannel(userId: string, method: string, body?: unknown): Promise<Response> {
  const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(userId));
  const url = new URL('https://owner-channel/waiting-check');
  url.searchParams.set('userId', userId);
  const response = await stub.fetch(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  // A Durable Object response has immutable headers and vinext adds its own to every route response
  // ("Can't modify immutable headers" on staging, 2026-10-04), so hand vinext a fresh copy.
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    return callOwnerChannel(user.id, 'GET');
  } catch (error) {
    console.error('WhatsApp waiting-check status failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося отримати стан перевірки WhatsApp.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    if (!sameOrigin(request)) return json({ error: 'Недійсний запит.' }, 403);
    const body = await readJsonObject(request, 8 * 1024);
    if (body instanceof Response) return body;
    if (!['start', 'retry_problems', 'stop'].includes(String(body.action))) return json({ error: 'Невідома дія.' }, 400);
    return callOwnerChannel(user.id, 'POST', body);
  } catch (error) {
    console.error('WhatsApp waiting-check action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося запустити перевірку WhatsApp. Спробуйте ще раз.' }, 500);
  }
}
