// /api/live — WebSocket upgrades for the owner live channel, answered at the Worker level BEFORE vinext.
//
// Found live on staging (2026-10-04, wrangler tail): vinext's route layer rebuilds every Response a
// route returns, and a 101 Switching Protocols response cannot be constructed ("Responses may only be
// constructed with status codes in the range 200 to 599"). Through a vinext route the Durable Object
// accepted the socket but the client always got a 500, so neither a browser nor the runner ever
// connected. scripts/normalize-wrangler-config.mjs bundles this file next to owner-channel.js and the
// generated worker-entry.js sends /api/live here, returning the DO's 101 response untouched.
//
// Auth happens here, once, before the DO sees the request: a browser proves itself with its normal
// session cookie, a runner with its executor bearer token — passed as a query parameter because the
// WebSocket constructor cannot set custom headers (TLS-protected, hashed at rest, revocable).
import { readSessionUser } from '../lib/session-user.ts';
import { authenticateDiscoveryExecutorToken } from '../lib/chat-discovery/executor-auth.ts';

/**
 * @param {D1Database} db
 * @param {Request} request
 * @param {number} now
 * @returns {Promise<{kind:'browser'|'runner', userId:string, deviceId:string}|null>}
 */
export async function resolveLiveCaller(db, request, now) {
  const url = new URL(request.url);
  if (url.searchParams.get('kind') === 'runner') {
    try {
      const auth = await authenticateDiscoveryExecutorToken(db, url.searchParams.get('token') || '', now);
      return { kind: 'runner', userId: auth.userId, deviceId: auth.deviceId };
    } catch {
      return null;
    }
  }
  const user = await readSessionUser(db, request.headers.get('Cookie'), now);
  return user ? { kind: 'browser', userId: user.id, deviceId: '' } : null;
}

/**
 * @param {Request} request
 * @param {Cloudflare.Env} env
 */
export async function handleLiveRequest(request, env) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 });
  }
  const caller = await resolveLiveCaller(env.DB, request, Math.floor(Date.now() / 1000));
  if (!caller) return new Response('Потрібна авторизація.', { status: 401 });

  const stub = env.OWNER_CHANNEL.get(env.OWNER_CHANNEL.idFromName(caller.userId));
  const forwardUrl = new URL(request.url);
  forwardUrl.searchParams.set('kind', caller.kind);
  forwardUrl.searchParams.set('userId', caller.userId);
  if (caller.deviceId) forwardUrl.searchParams.set('deviceId', caller.deviceId);
  else forwardUrl.searchParams.delete('deviceId');
  forwardUrl.searchParams.delete('token');
  return stub.fetch(new Request(forwardUrl, request));
}
