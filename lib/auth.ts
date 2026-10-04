import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { readCookie, readSessionUser, SESSION_COOKIE, sha256Hex as sha256, type SessionUser } from './session-user.ts';

export { SESSION_COOKIE };
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type WorkOsUser = SessionUser;

export async function getCurrentUser(): Promise<WorkOsUser | null> {
  const requestHeaders = await headers();
  return readSessionUser(env.DB, requestHeaders.get('cookie'), unixNow());
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = unixNow();

  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(tokenHash, userId, now, now + SESSION_TTL_SECONDS),
  ]);

  return token;
}

export async function deleteSession(token: string | null): Promise<void> {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
    .bind(await sha256(token))
    .run();
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function expiredSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Lax',
    'Max-Age=0',
  ]
    .filter(Boolean)
    .join('; ');
}

export function sessionTokenFromCookie(cookieHeader: string | null): string | null {
  return readCookie(cookieHeader, SESSION_COOKIE);
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
