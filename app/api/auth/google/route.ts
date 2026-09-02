import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  createSession,
  sessionCookie,
  upsertGoogleUser,
} from '@/lib/auth';

const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

export async function POST(request: Request): Promise<Response> {
  try {
    if (!sameOrigin(request)) return jsonError('Недійсний запит.', 403);

    const body = (await request.json()) as { credential?: unknown };
    if (typeof body.credential !== 'string' || !body.credential) {
      return jsonError('Google не передав дані для входу.', 400);
    }

    const { payload } = await jwtVerify(body.credential, googleKeys, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const ownerEmail = env.OWNER_EMAIL?.toLowerCase();
    if (!payload.sub || payload.email_verified !== true || !email) {
      return jsonError('Google-акаунт не підтверджено.', 401);
    }
    if (!ownerEmail || email !== ownerEmail) {
      return jsonError('Цей Google-акаунт не має доступу до Work OS.', 403);
    }

    const displayName =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : email;
    const pictureUrl = typeof payload.picture === 'string' ? payload.picture : null;

    await upsertGoogleUser({
      id: payload.sub,
      email,
      displayName,
      pictureUrl,
    });
    const sessionToken = await createSession(payload.sub);
    const secure = new URL(request.url).protocol === 'https:';

    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': sessionCookie(sessionToken, secure) } },
    );
  } catch (error) {
    console.error('Google sign-in failed', safeErrorName(error));
    return jsonError('Не вдалося перевірити Google-вхід. Спробуй ще раз.', 401);
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
