import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession, sessionCookie } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  AuthIdentityError,
  createGoogleAuthPolicy,
  resolveGoogleIdentity,
} from '@/lib/auth-identities';

const AUTH_REQUEST_MAX_BYTES = 16 * 1024;

const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

export async function POST(request: Request): Promise<Response> {
  try {
    if (!sameOrigin(request)) return jsonError('Недійсний запит.', 403);

    const parsed = await readJsonObject(request, AUTH_REQUEST_MAX_BYTES);
    if (parsed instanceof Response) return parsed;
    const body = parsed;
    if (typeof body.credential !== 'string' || !body.credential) {
      return jsonError('Google не передав дані для входу.', 400);
    }

    const { payload } = await jwtVerify(body.credential, googleKeys, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const policy = createGoogleAuthPolicy(
      env.OWNER_EMAIL,
      env.ALLOWED_GOOGLE_EMAILS,
    );
    if (!policy) return jsonError('Політика Google-доступу не налаштована.', 503);
    if (!payload.sub || payload.email_verified !== true || !email) {
      return jsonError('Google-акаунт не підтверджено.', 401);
    }
    const displayName =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : email;
    const pictureUrl = typeof payload.picture === 'string' ? payload.picture : null;

    const userId = await resolveGoogleIdentity(
      env.DB,
      { subject: payload.sub, email, displayName, pictureUrl },
      policy,
    );
    const sessionToken = await createSession(userId);
    const secure = new URL(request.url).protocol === 'https:';

    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': sessionCookie(sessionToken, secure) } },
    );
  } catch (error) {
    if (error instanceof AuthIdentityError) {
      const status = error.code === 'owner_not_initialized' ? 409 : 403;
      return jsonError(error.message, status);
    }
    console.error('Google sign-in failed', safeErrorName(error));
    return jsonError('Не вдалося перевірити Google-вхід. Спробуй ще раз.', 401);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
