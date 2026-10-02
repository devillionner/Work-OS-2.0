import { cleanChatName, normalizeGroupLink } from './bulk-input.ts';

// "Відібрані" Telegram chats: a one-off reference list imported from a groups export
// (group, username or invite link, how many messages the tracked person sent there).
// It lives in user_settings, so it needs no migration and never creates chats by itself;
// the operator moves a chat into work through the normal bulk-add flow.
const SETTING_KEY = 'telegram_selected_chats_v1';
export const SELECTED_MAX_ITEMS = 5000;
export const SELECTED_IMPORT_MAX_BYTES = 1_500_000;

export type SelectedChat = { link: string; title: string; count: number; last: string | null };
export type SelectedChatView = SelectedChat & { status: string | null; accountId: string | null };
export type SelectedChatsView = { importedAt: number | null; skipped: number; items: SelectedChatView[] };

type Stored = { importedAt: number; skipped: number; items: SelectedChat[] };

export class SelectedChatsError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// Accepts the raw export: an array of {title, username, link, msg_count_in_group, last}.
export function parseSelectedExport(value: unknown): { items: SelectedChat[]; skipped: number } {
  if (!Array.isArray(value) || !value.length) throw new SelectedChatsError('Файл має містити непорожній список груп.');
  if (value.length > SELECTED_MAX_ITEMS) throw new SelectedChatsError(`Забагато груп: максимум ${SELECTED_MAX_ITEMS}.`);
  const byLink = new Map<string, SelectedChat>();
  let skipped = 0;
  for (const raw of value) {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const username = typeof row.username === 'string' ? row.username.trim().replace(/^@/, '') : '';
    const source = username ? `https://t.me/${username}` : typeof row.link === 'string' ? row.link : '';
    const normalized = source ? normalizeGroupLink(source) : null;
    if (!normalized || normalized.platform !== 'telegram') { skipped += 1; continue; }
    const count = Math.max(0, Math.floor(Number(row.msg_count_in_group) || 0));
    const last = typeof row.last === 'string' && !Number.isNaN(Date.parse(row.last)) ? row.last : null;
    const title = cleanChatName(typeof row.title === 'string' ? row.title : '') || normalized.link;
    const previous = byLink.get(normalized.link);
    if (!previous || count > previous.count) byLink.set(normalized.link, { link: normalized.link, title, count, last });
    else skipped += 1;
  }
  if (!byLink.size) throw new SelectedChatsError('У файлі не знайдено жодного Telegram-чату з username або посиланням.');
  return { items: [...byLink.values()], skipped };
}

export async function saveSelectedChats(db: D1Database, userId: string, parsed: { items: SelectedChat[]; skipped: number }, now: number) {
  const stored: Stored = { importedAt: now, skipped: parsed.skipped, items: parsed.items };
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
    VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(userId, SETTING_KEY, JSON.stringify(stored), now).run();
  return readSelectedChats(db, userId);
}

async function readStored(db: D1Database, userId: string): Promise<Stored | null> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId, SETTING_KEY).first<{ value_json: string }>();
  try {
    const stored = row ? JSON.parse(row.value_json) as Stored : null;
    return stored && Array.isArray(stored.items) && stored.items.length ? stored : null;
  } catch { return null; }
}

// Tab badge only: one settings row, no per-chat status lookup.
export async function readSelectedChatsCount(db: D1Database, userId: string) {
  return { count: (await readStored(db, userId))?.items.length ?? 0 };
}

// Most active chats first; each row says whether the chat is already in Work OS, where and for which account.
export async function readSelectedChats(db: D1Database, userId: string): Promise<SelectedChatsView> {
  const stored = await readStored(db, userId);
  if (!stored) return { importedAt: null, skipped: 0, items: [] };
  const statuses = await db.prepare(`SELECT c.normalized_link AS link,c.workflow_status AS status,c.telegram_account_id AS account_id
    FROM json_each(?2) j JOIN chats c ON c.user_id=?1 AND c.platform='telegram' AND c.normalized_link=j.value`)
    .bind(userId, JSON.stringify(stored.items.map(item => item.link))).all<{ link: string; status: string; account_id: string | null }>();
  const statusByLink = new Map(statuses.results.map(item => [item.link, item]));
  const items = stored.items
    .map(item => ({ ...item, status: statusByLink.get(item.link)?.status ?? null, accountId: statusByLink.get(item.link)?.account_id ?? null }))
    .sort((a, b) => b.count - a.count || (b.last ?? '').localeCompare(a.last ?? '') || a.title.localeCompare(b.title, 'uk'));
  return { importedAt: stored.importedAt ?? null, skipped: stored.skipped ?? 0, items };
}
