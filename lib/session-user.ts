// Session lookup without framework imports, shared by lib/auth.ts (vinext routes) and the Worker-level
// /api/live gateway (workers/live-gateway.js), which runs before vinext and so cannot use next/headers.
export const SESSION_COOKIE = 'work_os_session';

export type SessionUser = {
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

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=') || null;
  }
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readSessionUser(db: D1Database, cookieHeader: string | null, now: number): Promise<SessionUser | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.email, u.display_name, u.picture_url
     FROM sessions AS s
     INNER JOIN users AS u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2
     LIMIT 1`,
  ).bind(await sha256Hex(token), now).first<SessionRow>();
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, pictureUrl: row.picture_url };
}
