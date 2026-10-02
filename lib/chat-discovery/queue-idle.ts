// The Discovery executor queue read scans the owner's candidates, so an empty answer is remembered:
// an idle runner then pays one settings row per poll instead of a scan. Anything that can create
// executor work (Discovery actions, executor results, WhatsApp/Viber chat moves) clears the marker.
export const QUEUE_IDLE_SETTING_KEY = 'discovery_executor_queue_idle_until_v1';
export const QUEUE_LAST_WORK_SETTING_KEY = 'discovery_executor_queue_last_work_v1';
export const DISCOVERY_QUEUE_IDLE_SECONDS = 1800;
// Right after the runner had work, scheduled retries (5–10 min) must not wait for the long idle window.
export const DISCOVERY_QUEUE_BUSY_IDLE_SECONDS = 60;
const RECENT_WORK_SECONDS = 900;

export async function readDiscoveryQueueMarkers(db: D1Database, userId: string) {
  const rows = await db.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN (?2,?3)`)
    .bind(userId, QUEUE_IDLE_SETTING_KEY, QUEUE_LAST_WORK_SETTING_KEY).all<{ setting_key: string; value_json: string }>();
  const value = (key: string) => {
    const number = Number(rows.results.find(row => row.setting_key === key)?.value_json);
    return Number.isSafeInteger(number) ? number : 0;
  };
  return { idleUntil: value(QUEUE_IDLE_SETTING_KEY), lastWorkAt: value(QUEUE_LAST_WORK_SETTING_KEY) };
}

async function writeMarker(db: D1Database, userId: string, key: string, value: number, now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
    VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(userId, key, String(value), now).run();
}

export async function markDiscoveryQueueIdle(db: D1Database, userId: string, lastWorkAt: number, now: number) {
  const window = now - lastWorkAt < RECENT_WORK_SECONDS ? DISCOVERY_QUEUE_BUSY_IDLE_SECONDS : DISCOVERY_QUEUE_IDLE_SECONDS;
  await writeMarker(db, userId, QUEUE_IDLE_SETTING_KEY, now + window, now);
}

export async function markDiscoveryQueueWork(db: D1Database, userId: string, now: number) {
  await writeMarker(db, userId, QUEUE_LAST_WORK_SETTING_KEY, now, now);
}

export function wakeDiscoveryExecutorQueueStatement(db: D1Database, userId: string) {
  return db.prepare(`DELETE FROM user_settings WHERE user_id=?1 AND setting_key=?2`).bind(userId, QUEUE_IDLE_SETTING_KEY);
}

export async function wakeDiscoveryExecutorQueue(db: D1Database, userId: string) {
  await wakeDiscoveryExecutorQueueStatement(db, userId).run();
}
