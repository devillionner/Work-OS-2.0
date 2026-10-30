import { sendWebPush, type PushPayload, type PushSubscriptionRecord } from './web-push.ts';

// Підписки на сповіщення телефона лежать в одному рядку user_settings (міграція не потрібна): масив із пристроїв власника.
const KEY = 'push_subscriptions_v1';
const MAX_SUBSCRIPTIONS = 8;

export async function readPushSubscriptions(db: D1Database, userId: string): Promise<PushSubscriptionRecord[]> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, KEY).first<{ value_json: string }>();
  try {
    const parsed: unknown = row ? JSON.parse(row.value_json) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch { return []; }
}

function isRecord(value: unknown): value is PushSubscriptionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.endpoint === 'string' && typeof item.p256dh === 'string' && typeof item.auth === 'string';
}

async function save(db: D1Database, userId: string, list: PushSubscriptionRecord[], now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(userId, KEY, JSON.stringify(list), now).run();
}

/** Підписку, надіслану браузером (`PushSubscription.toJSON()`), приймаємо лише від https-сервісу push з коректними ключами. */
export function cleanSubscription(input: unknown, now: number): PushSubscriptionRecord | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  const p256dh = typeof raw.keys?.p256dh === 'string' ? raw.keys.p256dh : '';
  const auth = typeof raw.keys?.auth === 'string' ? raw.keys.auth : '';
  if (!/^https:\/\/[^\s]{8,1000}$/.test(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  return { endpoint, p256dh, auth, createdAt: now };
}

export async function addPushSubscription(db: D1Database, userId: string, subscription: PushSubscriptionRecord, now: number): Promise<number> {
  const current = await readPushSubscriptions(db, userId);
  const next = [subscription, ...current.filter((item) => item.endpoint !== subscription.endpoint)].slice(0, MAX_SUBSCRIPTIONS);
  await save(db, userId, next, now);
  return next.length;
}

export async function removePushSubscription(db: D1Database, userId: string, endpoint: string, now: number): Promise<number> {
  const current = await readPushSubscriptions(db, userId);
  const next = current.filter((item) => item.endpoint !== endpoint);
  if (next.length !== current.length) await save(db, userId, next, now);
  return next.length;
}

/** Надсилає сповіщення на всі пристрої власника; недійсні підписки (404/410) прибирає. Повертає, скільком пристроям дісталось. */
export async function pushToOwner(db: D1Database, privateKey: string | undefined, userId: string, payload: PushPayload, now: number): Promise<number> {
  if (!privateKey) return 0;
  const subscriptions = await readPushSubscriptions(db, userId);
  if (!subscriptions.length) return 0;
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try { return { subscription, result: await sendWebPush(subscription, payload, privateKey) }; }
    catch { return { subscription, result: { ok: false, status: 0, gone: false } }; }
  }));
  const gone = results.filter((item) => item.result.gone).map((item) => item.subscription.endpoint);
  if (gone.length) await save(db, userId, subscriptions.filter((item) => !gone.includes(item.endpoint)), now);
  return results.filter((item) => item.result.ok).length;
}
