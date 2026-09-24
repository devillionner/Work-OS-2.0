import { DiscoveryError } from './domain.ts';
import { releaseMessengerAutomationJobsForDevice } from '../messenger-automation.ts';

const EXECUTOR_HEARTBEAT_SECONDS = 60;

export type DiscoveryExecutorDevice = {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
};

export async function createDiscoveryExecutorDevice(
  db: D1Database,
  userId: string,
  nameInput: unknown,
  now: number,
): Promise<{ device: DiscoveryExecutorDevice; token: string }> {
  const name = typeof nameInput === 'string' ? nameInput.trim().slice(0, 80) : '';
  if (!name) throw new DiscoveryError('Вкажіть назву пристрою executor.');
  const id = crypto.randomUUID();
  const token = `wos_exec_${randomToken()}`;
  const tokenHash = await hashExecutorToken(token);
  await db.prepare(`INSERT INTO chat_discovery_executor_devices
    (id,user_id,name,token_hash,created_at,last_seen_at,revoked_at)
    VALUES (?1,?2,?3,?4,?5,NULL,NULL)`)
    .bind(id, userId, name, tokenHash, now).run();
  return { device: { id, name, createdAt: now, lastSeenAt: null }, token };
}

export async function listDiscoveryExecutorDevices(db: D1Database, userId: string): Promise<DiscoveryExecutorDevice[]> {
  const rows = await db.prepare(`SELECT id,name,created_at,last_seen_at
    FROM chat_discovery_executor_devices
    WHERE user_id=?1 AND revoked_at IS NULL
    ORDER BY created_at DESC,id`).bind(userId).all<{
      id:string;name:string;created_at:number;last_seen_at:number|null;
    }>();
  return rows.results.map(row => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function revokeDiscoveryExecutorDevice(
  db: D1Database,
  userId: string,
  deviceId: string,
  now: number,
) {
  const result = await db.prepare(`UPDATE chat_discovery_executor_devices
    SET revoked_at=?1 WHERE id=?2 AND user_id=?3 AND revoked_at IS NULL`)
    .bind(now, deviceId, userId).run();
  if (Number(result.meta.changes || 0) !== 1) throw new DiscoveryError('Підключення executor не знайдено.', 404);
  await db.prepare(`UPDATE chat_discovery_candidates
    SET executor_lease_device_id=NULL,executor_lease_expires_at=NULL
    WHERE user_id=?1 AND executor_lease_device_id=?2`).bind(userId, deviceId).run();
  await releaseMessengerAutomationJobsForDevice(db,userId,deviceId,now);
  return { ok: true };
}

export async function authenticateDiscoveryExecutor(
  db: D1Database,
  request: Request,
  now: number,
): Promise<{ userId: string; deviceId: string }> {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new DiscoveryError('Потрібен executor token.', 401);
  const token = authorization.slice(7).trim();
  if (!token.startsWith('wos_exec_') || token.length > 200) throw new DiscoveryError('Недійсний executor token.', 401);
  const tokenHash = await hashExecutorToken(token);
  const row = await db.prepare(`SELECT id,user_id,last_seen_at FROM chat_discovery_executor_devices
    WHERE token_hash=?1 AND revoked_at IS NULL LIMIT 1`).bind(tokenHash).first<{id:string;user_id:string;last_seen_at:number|null}>();
  if (!row) throw new DiscoveryError('Executor token відкликано або він недійсний.', 401);
  const heartbeatCutoff = now - EXECUTOR_HEARTBEAT_SECONDS;
  if (row.last_seen_at === null || row.last_seen_at <= heartbeatCutoff) {
    await db.prepare(`UPDATE chat_discovery_executor_devices
      SET last_seen_at=?1
      WHERE id=?2 AND revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<=?3)`)
      .bind(now, row.id, heartbeatCutoff).run();
  }
  return { userId: row.user_id, deviceId: row.id };
}

async function hashExecutorToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
