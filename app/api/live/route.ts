import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { authenticateDiscoveryExecutorToken } from '@/lib/chat-discovery/executor-auth';

// Upgrades to this route are forwarded to the owner's single Durable Object (workers/owner-channel.ts),
// which holds live process/command state so neither the browser nor the runner has to poll D1 to find
// out what the other is doing. Auth happens here, once, before the DO ever sees the request: a browser
// client proves itself with its normal session cookie, a runner with its existing executor bearer
// token — passed as a query parameter because the WebSocket constructor cannot set custom headers.
export async function GET(request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'runner' ? 'runner' : 'browser';
  const now = Math.floor(Date.now() / 1000);

  let userId: string;
  let deviceId = '';
  if (kind === 'runner') {
    try {
      const auth = await authenticateDiscoveryExecutorToken(env.DB, url.searchParams.get('token') || '', now);
      userId = auth.userId;
      deviceId = auth.deviceId;
    } catch {
      return new Response('Executor token відкликано або він недійсний.', { status: 401 });
    }
  } else {
    const user = await getCurrentUser();
    if (!user) return new Response('Потрібна авторизація.', { status: 401 });
    userId = user.id;
  }

  const id = env.OWNER_CHANNEL.idFromName(userId);
  const stub = env.OWNER_CHANNEL.get(id);
  const forwardUrl = new URL(request.url);
  forwardUrl.searchParams.set('kind', kind);
  if (deviceId) forwardUrl.searchParams.set('deviceId', deviceId);
  else forwardUrl.searchParams.delete('deviceId');
  forwardUrl.searchParams.delete('token');
  return stub.fetch(new Request(forwardUrl, request));
}
