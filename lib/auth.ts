import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';

export const SESSION_COOKIE = 'work_os_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type WorkOsUser = {
  id: string;
  email: string;
  displayName: string;
  pictureUrl: string | null;
};

type SessionRow = {
  id: string;
  email: string;
  display_name: string;
  picture_url: string | null;
};

export async function getCurrentUser(): Promise<WorkOsUser | null> {
  const requestHeaders = await headers();
  const token = readCookie(requestHeaders.get('cookie'), SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.picture_url
     FROM sessions AS s
     INNER JOIN users AS u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2
     LIMIT 1`,
  )
    .bind(tokenHash, unixNow())
    .first<SessionRow>();

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
  };
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

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=') || null;
  }
  return null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
