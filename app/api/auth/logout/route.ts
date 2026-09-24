import {
  deleteSession,
  expiredSessionCookie,
  sessionTokenFromCookie,
} from '@/lib/auth';

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });

  await deleteSession(sessionTokenFromCookie(request.headers.get('cookie')));
  const url = new URL('/', request.url);
  const secure = url.protocol === 'https:';
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      'Set-Cookie': expiredSessionCookie(secure),
    },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
