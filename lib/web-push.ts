// Web Push без бібліотек: шифрування за RFC 8291 (aes128gcm) і підпис VAPID (RFC 8292) через crypto.subtle воркера.
// Публічний ключ відкритий (його бачить і браузер), приватна частина — секрет воркера VAPID_PRIVATE_KEY (base64url, 32 байти).
export const VAPID_PUBLIC_KEY = 'BJLBWR3R2Qgw3UKTezFfgbcz1X1ilkrZnqbMd9k0VO1b5ckLOeiBKNxKYtOYf2tzc4wZ5yD7va8RCnhZaOZCnnc';
const VAPID_SUBJECT = 'mailto:work-os@devillionner.workers.dev';

export type PushSubscriptionRecord = { endpoint: string; p256dh: string; auth: string; createdAt: number };
export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type PushResult = { ok: boolean; status: number; gone: boolean };

const encoder = new TextEncoder();

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}
function bytesToB64url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hkdf(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Тіло push-повідомлення за RFC 8291: salt, record size, ключ відправника й шифротекст в одному aes128gcm-записі. */
export async function encryptPushBody(subscription: PushSubscriptionRecord, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(subscription.p256dh);
  const authSecret = b64urlToBytes(subscription.auth);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(shared, authSecret, keyInfo, 32);
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 — роздільник останнього запису (доповнення не потрібне).
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

async function vapidAuthorization(endpoint: string, privateKey: string): Promise<string> {
  const publicBytes = b64urlToBytes(VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(publicBytes.slice(1, 33)), y: bytesToB64url(publicBytes.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${VAPID_PUBLIC_KEY}`;
}

/** Одне push-повідомлення одній підписці. `gone` — підписка недійсна (404/410): її треба прибрати. */
export async function sendWebPush(subscription: PushSubscriptionRecord, payload: PushPayload, privateKey: string): Promise<PushResult> {
  if (!privateKey) return { ok: false, status: 0, gone: false };
  const body = await encryptPushBody(subscription, encoder.encode(JSON.stringify(payload)));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, privateKey),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'normal',
    },
    body,
  });
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}
