/**
 * Активний Telegram-акаунт для дії: вказаний (якщо ввімкнений) або вибраний за замовчуванням. Якщо акаунтів ще немає,
 * створюється «TG 1» — так само, як це робив список чатів.
 */
export async function resolveTelegramAccount(db: D1Database, userId: string, requested: string | null, now: number): Promise<string | null> {
  let row = requested
    ? await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(requested, userId).first<{ id: string }>()
    : await db.prepare(`SELECT id FROM telegram_accounts WHERE user_id=?1 AND is_enabled=1 ORDER BY is_selected DESC,account_number LIMIT 1`).bind(userId).first<{ id: string }>();
  if (!row && !requested) {
    const id = `${userId}:tg1`;
    await db.prepare(`INSERT OR IGNORE INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES (?1,?2,1,'TG 1',1,1,?3,?3)`).bind(id, userId, now).run();
    row = await db.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(id, userId).first<{ id: string }>();
  }
  return row?.id || null;
}
