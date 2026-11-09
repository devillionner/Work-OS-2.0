/**
 * Перенесення runner на іншу систему: одноразовий код встановлення й архів входів у хмарі (R2 `FILES`).
 * Метадані архівів — один рядок `user_settings` (без таблиці й без опитувань), самі архіви — ключі `runner-backup/<власник>/<id>`.
 * Архів зашифровано на ПК паролем, який сюди ніколи не потрапляє.
 */

export const ENROLL_CODE_TTL_SECONDS = 15 * 60;
/** Розмір частини multipart: ≤ 50 МБ, усі частини однакові, крім останньої (вимога R2). */
export const BACKUP_PART_SIZE = 32 * 1024 * 1024;
export const BACKUP_PART_MAX_BYTES = 50 * 1024 * 1024;
/** Стеля розміру архіву: 8 ГБ (256 частин). */
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024 * 1024;
export const BACKUPS_KEPT = 2;
const KEY = 'runner_backups_v1';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type RunnerBackup = { id: string; createdAt: number; sizeBytes: number; sha256: string; version: string; partSize: number; parts: number; host: string };

export const backupObjectKey = (userId: string, id: string) => `runner-backup/${userId}/${id}`;
export const cleanBackupId = (value: unknown) => (typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : '');

/** Код вигляду `7KQ4-M2XP` (без схожих символів): 8 символів ≈ 40 біт, живе 15 хв і одне використання. */
export function generateEnrollCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
export function normalizeEnrollCode(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}
export async function hashEnrollCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`work-os-runner-enroll:${normalizeEnrollCode(code)}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readRunnerBackups(db: D1Database, userId: string): Promise<RunnerBackup[]> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, KEY).first<{ value_json: string }>();
  try {
    const parsed: unknown = row ? JSON.parse(row.value_json) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RunnerBackup => Boolean(item) && typeof item === 'object' && typeof (item as RunnerBackup).id === 'string' && Number.isFinite((item as RunnerBackup).sizeBytes));
  } catch { return []; }
}

export async function saveRunnerBackups(db: D1Database, userId: string, list: RunnerBackup[], now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(userId, KEY, JSON.stringify(list), now).run();
}

/** Додає щойно завершений архів, лишає два останні, видаляє старіші з R2. */
export async function registerRunnerBackup(db: D1Database, files: R2Bucket, userId: string, entry: RunnerBackup, now: number): Promise<RunnerBackup[]> {
  const current = await readRunnerBackups(db, userId);
  const next = [entry, ...current.filter((item) => item.id !== entry.id)];
  const kept = next.slice(0, BACKUPS_KEPT);
  await saveRunnerBackups(db, userId, kept, now);
  for (const old of next.slice(BACKUPS_KEPT)) await files.delete(backupObjectKey(userId, old.id)).catch(() => undefined);
  return kept;
}

export async function removeRunnerBackup(db: D1Database, files: R2Bucket, userId: string, id: string, now: number): Promise<RunnerBackup[]> {
  const current = await readRunnerBackups(db, userId);
  const next = current.filter((item) => item.id !== id);
  await files.delete(backupObjectKey(userId, id)).catch(() => undefined);
  if (next.length !== current.length) await saveRunnerBackups(db, userId, next, now);
  return next;
}
