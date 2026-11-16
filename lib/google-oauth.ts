/**
 * Вхід через Google перенаправленням (OAuth 2.0 authorization code flow з PKCE і state). Працює в будь-якому браузері, зокрема в Electron,
 * де вікно Google Identity Services не передає справжнє походження сторінки (`origin_mismatch`).
 * Без залежностей, крім `jose` (уже в проєкті): fetch + crypto.subtle; підпис id_token перевіряється через JWKS Google (кеш у `createRemoteJWKSet`).
 */
export const OAUTH_COOKIE = 'work_os_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth/google';
export const OAUTH_TTL_SECONDS = 600;
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const ERROR_TEXT: Record<string, string> = {
  denied: 'Вхід скасовано в Google. Спробуй ще раз.',
  session_expired: 'Час входу минув або сторінку відкрито в іншому браузері. Спробуй ще раз.',
  state_mismatch: 'Не вдалося підтвердити запит на вхід. Спробуй ще раз.',
  not_configured: 'Вхід через Google ще не налаштовано.',
  exchange_failed: 'Google не підтвердив вхід: код недійсний або прострочений. Спробуй ще раз.',
  token_invalid: 'Не вдалося перевірити відповідь Google. Спробуй ще раз.',
  email_unverified: 'Google-акаунт не підтверджено.',
  not_allowed: 'Цей Google-акаунт не має доступу до Work OS.',
  owner_not_initialized: 'Власника ще не налаштовано.',
  policy_missing: 'Політика Google-доступу не налаштована.',
  failed: 'Не вдалося увійти. Спробуй ще раз.',
};

/** Людський текст за кодом помилки з адреси (сирі повідомлення Google до екрана не доходять). */
export function authErrorText(code: string | null | undefined): string {
  return code ? ERROR_TEXT[code] ?? ERROR_TEXT.failed : '';
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export const randomValue = (bytes = 32) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Те, що лежить у короткоживучій cookie: state, code_verifier і nonce. */
export type OAuthTransaction = { state: string; verifier: string; nonce: string };

export const encodeTransaction = (value: OAuthTransaction) => `${value.state}.${value.verifier}.${value.nonce}`;
export function decodeTransaction(raw: string | null): OAuthTransaction | null {
  const parts = (raw ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]{16,128}$/.test(part))) return null;
  return { state: parts[0], verifier: parts[1], nonce: parts[2] };
}

export function transactionCookie(value: string, secure: boolean, maxAge = OAUTH_TTL_SECONDS): string {
  return [`${OAUTH_COOKIE}=${value}`, `Path=${OAUTH_COOKIE_PATH}`, 'HttpOnly', secure ? 'Secure' : '', 'SameSite=Lax', `Max-Age=${maxAge}`].filter(Boolean).join('; ');
}

export function redirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}${OAUTH_COOKIE_PATH}/callback`;
}

export function authorizeUrl(input: { clientId: string; redirect: string; state: string; nonce: string; challenge: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirect, response_type: 'code', scope: 'openid email profile',
    state: input.state, nonce: input.nonce, code_challenge: input.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Порівняння без раннього виходу (state з адреси проти cookie). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
