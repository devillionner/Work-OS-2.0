import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

const ACTIONS = new Set(['start', 'resume', 'pause', 'confirmed', 'archived', 'non-target', 'retry']);

// The Discovery autonomous run lives in the owner's Durable Object (workers/owner-channel.js) since
// 2026-10-04; this route is its thin authenticated HTTP bridge, like the Waiting check's.
async function callOwnerChannel(userId: string, method: string, body?: unknown): Promise<Response> {
  const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(userId));
  const url = new URL('https://owner-channel/discovery-run');
  url.searchParams.set('userId', userId);
  const response = await stub.fetch(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  // A Durable Object response has immutable headers and vinext adds its own to every route response,
  // so hand vinext a fresh copy (see the Waiting-check route).
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
    console.error('Discovery run status failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося отримати стан автопошуку.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Потрібно увійти.' }, 401);
    if (!sameOrigin(request)) return json({ error: 'Недійсний запит.' }, 403);
    const body = await readJsonObject(request, 64 * 1024);
    if (body instanceof Response) return body;
    if (!ACTIONS.has(String(body.action))) return json({ error: 'Невідома дія.' }, 400);
    return callOwnerChannel(user.id, 'POST', body);
  } catch (error) {
    console.error('Discovery run action failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не вдалося змінити автопошук. Спробуйте ще раз.' }, 500);
  }
}
