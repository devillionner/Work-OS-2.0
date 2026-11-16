import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession, sessionCookie } from '@/lib/auth';
import { AuthIdentityError, createGoogleAuthPolicy, resolveGoogleIdentity } from '@/lib/auth-identities';
import { GOOGLE_TOKEN_URL, decodeTransaction, redirectUri, safeEqual, transactionCookie, OAUTH_COOKIE } from '@/lib/google-oauth';
import { readCookie } from '@/lib/session-user';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Повернення з Google: перевірка state, обмін code на токени (PKCE + client secret), перевірка id_token, та сама політика «лише власнику», сесія, редірект на /. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const clear = transactionCookie('', secure, 0);
  const fail = (code: string) => new Response(null, { status: 302, headers: { Location: `${url.origin}/?auth_error=${code}`, 'Set-Cookie': clear, 'Cache-Control': 'no-store' } });
  try {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('not_configured');
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'denied' : 'failed');
    const transaction = decodeTransaction(readCookie(request.headers.get('cookie'), OAUTH_COOKIE));
    if (!transaction) return fail('session_expired');
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    if (!state || !safeEqual(state, transaction.state)) return fail('state_mismatch');
    if (!code) return fail('failed');

    const exchange = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(request.url),
        grant_type: 'authorization_code', code_verifier: transaction.verifier,
      }),
    });
    if (!exchange.ok) return fail('exchange_failed');
    const tokens = await exchange.json() as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string' || !tokens.id_token) return fail('token_invalid');

    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, transaction.nonce)) return fail('token_invalid');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!payload.sub || payload.email_verified !== true || !email) return fail('email_unverified');
    const policy = createGoogleAuthPolicy(env.OWNER_EMAIL, env.ALLOWED_GOOGLE_EMAILS);
    if (!policy) return fail('policy_missing');

    const userId = await resolveGoogleIdentity(env.DB, {
      subject: payload.sub, email,
      displayName: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : email,
      pictureUrl: typeof payload.picture === 'string' ? payload.picture : null,
    }, policy);
    const headers = new Headers({ Location: `${url.origin}/`, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', sessionCookie(await createSession(userId), secure));
    headers.append('Set-Cookie', clear);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof AuthIdentityError) return fail(error.code === 'owner_not_initialized' ? 'owner_not_initialized' : 'not_allowed');
    console.error('Google redirect sign-in failed', error instanceof Error ? error.name : 'UnknownError');
    return fail('token_invalid');
  }
}
