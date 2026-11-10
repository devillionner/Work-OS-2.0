/**
 * Що публікує автопост Telegram: пул оголошень (`pool`: кожен чат отримує свій текст, один текст раз на добу) чи власний матеріал (`own`: одне фото
 * й текст для всіх, а без власного тексту оголошення з Бібліотеки за профілем чату). Вибір власника лежить в одному рядку `user_settings` і
 * однаковий для всіх акаунтів Telegram. Без вибору: пул, якщо він не порожній, інакше власний матеріал.
 */
export type TelegramSource = 'pool' | 'own';
const KEY = 'telegram_autopost_source_v1';

export async function readSavedSource(db: D1Database, userId: string): Promise<TelegramSource | null> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, KEY).first<{ value_json: string }>();
  try { const value: unknown = row ? JSON.parse(row.value_json) : null; return value === 'pool' || value === 'own' ? value : null; } catch { return null; }
}

/** Режим, за яким працює партія: збережений вибір; «пул» без текстів у пулі нічого не дає, тож тоді власний матеріал. */
export function effectiveSource(saved: TelegramSource | null, poolActive: boolean): TelegramSource {
  if (saved === 'own') return 'own';
  return poolActive ? 'pool' : 'own';
}

export async function saveSource(db: D1Database, userId: string, mode: TelegramSource, now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(userId, KEY, JSON.stringify(mode), now).run();
}

/** Чи є власний матеріал: власний текст автопосту або хоч одне неархівне оголошення Бібліотеки (не з пулу). Фото необов'язкове. */
export async function ownMaterialAvailable(db: D1Database, userId: string, hasCaption: boolean): Promise<boolean> {
  if (hasCaption) return true;
  const row = await db.prepare(`SELECT 1 AS hit FROM library_items WHERE user_id=?1 AND kind='advertisement' AND archived_at IS NULL AND NOT (id>='tgp_' AND id<'tgp\`') AND platforms_json LIKE '%telegram%' LIMIT 1`).bind(userId).first<{ hit: number }>();
  return Boolean(row);
}
