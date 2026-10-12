import { businessDate } from '../business-time.ts';
import { cleanChatName, normalizeGroupLink } from './bulk-input.ts';

// "Відібрані" Telegram chats: a one-off reference list imported from a groups export
// (group, username or invite link, how many messages the tracked person sent there).
// It lives in user_settings, so it needs no migration and never creates chats by itself;
// the operator moves a chat into work through the normal bulk-add flow.
const SETTING_KEY = 'telegram_selected_chats_v1';
// Кілька іменованих списків: один рядок метаданих (назви й порядок) + рядок на кожен список. Перший список лишається
// у старому рядку SETTING_KEY, тож існуючі дані стають «Відібрані 1» без міграції.
const META_KEY = 'telegram_selected_lists_v1';
export const DEFAULT_LIST_ID = 'l1';
export const SELECTED_MAX_LISTS = 12;
const LIST_NAME_MAX = 40;
const listKey = (id: string) => (id === DEFAULT_LIST_ID ? SETTING_KEY : `${SETTING_KEY}:${id}`);

export type SelectedListInfo = { id: string; name: string; count: number };
type ListsMeta = { lists: Array<{ id: string; name: string; count?: number }> };
const DEFAULT_META: ListsMeta = { lists: [{ id: DEFAULT_LIST_ID, name: 'Відібрані 1' }] };
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

export async function saveSelectedChats(db: D1Database, userId: string, parsed: { items: SelectedChat[]; skipped: number }, now: number, listIdInput?: unknown) {
  const { meta } = await readMeta(db, userId);
  const listId = resolveListId(meta, listIdInput);
  const stored: Stored = { importedAt: now, skipped: parsed.skipped, items: parsed.items };
  await db.batch([
    db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
      VALUES (?1,?2,?3,NULL,?4)
      ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .bind(userId, listKey(listId), JSON.stringify(stored), now),
    saveMetaStatement(db, userId, { lists: meta.lists.map(item => (item.id === listId ? { ...item, count: parsed.items.length } : item)) }, now),
  ]);
  return readSelectedChats(db, userId, listId);
}

async function readMeta(db: D1Database, userId: string): Promise<{ meta: ListsMeta; stored: boolean }> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId, META_KEY).first<{ value_json: string }>();
  try {
    const parsed = row ? JSON.parse(row.value_json) as ListsMeta : null;
    const lists = parsed && Array.isArray(parsed.lists)
      ? parsed.lists.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && /^[a-z0-9]{1,16}$/.test(item.id))
      : [];
    return lists.length ? { meta: { lists }, stored: true } : { meta: DEFAULT_META, stored: false };
  } catch { return { meta: DEFAULT_META, stored: false }; }
}

function saveMetaStatement(db: D1Database, userId: string, meta: ListsMeta, now: number) {
  return db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
    VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(userId, META_KEY, JSON.stringify(meta), now);
}

function resolveListId(meta: ListsMeta, requested: unknown): string {
  const id = typeof requested === 'string' && requested ? requested : meta.lists[0].id;
  if (!meta.lists.some(item => item.id === id)) throw new SelectedChatsError('Такого списку немає. Оновіть сторінку.', 404);
  return id;
}

function cleanListName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, LIST_NAME_MAX) : '';
}

async function readStored(db: D1Database, userId: string, listId: string = DEFAULT_LIST_ID): Promise<Stored | null> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId, listKey(listId)).first<{ value_json: string }>();
  try {
    const stored = row ? JSON.parse(row.value_json) as Stored : null;
    return stored && Array.isArray(stored.items) && stored.items.length ? stored : null;
  } catch { return null; }
}

// Tab badge only: one settings row, no per-chat status lookup.
export async function readSelectedChatsCount(db: D1Database, userId: string) {
  const { meta } = await readMeta(db, userId);
  // Лічильник списку зберігається в метаданих при імпорті; для старого списку без нього рахуємо з його рядка.
  const lists: SelectedListInfo[] = await Promise.all(meta.lists.map(async item => ({
    id: item.id, name: item.name,
    count: typeof item.count === 'number' ? item.count : (await readStored(db, userId, item.id))?.items.length ?? 0,
  })));
  return { count: lists.reduce((sum, item) => sum + item.count, 0), lists };
}

export async function createSelectedList(db: D1Database, userId: string, nameInput: unknown, now: number): Promise<SelectedListInfo[]> {
  const { meta } = await readMeta(db, userId);
  if (meta.lists.length >= SELECTED_MAX_LISTS) throw new SelectedChatsError(`Можна мати не більше ${SELECTED_MAX_LISTS} списків.`, 409);
  const used = new Set(meta.lists.map(item => item.name.toLocaleLowerCase('uk-UA')));
  let number = meta.lists.length + 1;
  while (used.has(`відібрані ${number}`)) number += 1;
  const name = cleanListName(nameInput) || `Відібрані ${number}`;
  if (used.has(name.toLocaleLowerCase('uk-UA'))) throw new SelectedChatsError('Список із такою назвою вже є.', 409);
  const id = `l${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  await saveMetaStatement(db, userId, { lists: [...meta.lists, { id, name, count: 0 }] }, now).run();
  return (await readSelectedChatsCount(db, userId)).lists;
}

export async function renameSelectedList(db: D1Database, userId: string, listId: unknown, nameInput: unknown, now: number): Promise<SelectedListInfo[]> {
  const { meta } = await readMeta(db, userId);
  const id = resolveListId(meta, listId);
  const name = cleanListName(nameInput);
  if (!name) throw new SelectedChatsError('Вкажіть назву списку.');
  if (meta.lists.some(item => item.id !== id && item.name.toLocaleLowerCase('uk-UA') === name.toLocaleLowerCase('uk-UA'))) throw new SelectedChatsError('Список із такою назвою вже є.', 409);
  await saveMetaStatement(db, userId, { lists: meta.lists.map(item => (item.id === id ? { ...item, name } : item)) }, now).run();
  return (await readSelectedChatsCount(db, userId)).lists;
}

// Видалення списку не чіпає чати, уже додані в роботу: зникає лише довідковий список і його рядок налаштувань.
export async function deleteSelectedList(db: D1Database, userId: string, listId: unknown, now: number): Promise<SelectedListInfo[]> {
  const { meta } = await readMeta(db, userId);
  const id = resolveListId(meta, listId);
  if (meta.lists.length <= 1) throw new SelectedChatsError('Останній список видалити не можна.', 409);
  await db.batch([
    db.prepare(`DELETE FROM user_settings WHERE user_id=?1 AND setting_key=?2`).bind(userId, listKey(id)),
    saveMetaStatement(db, userId, { lists: meta.lists.filter(item => item.id !== id) }, now),
  ]);
  return (await readSelectedChatsCount(db, userId)).lists;
}

// Most active chats first; each row says whether the chat is already in Work OS, where and for which account.
export async function readSelectedChats(db: D1Database, userId: string, listIdInput?: unknown): Promise<SelectedChatsView> {
  const { meta } = await readMeta(db, userId);
  const stored = await readStored(db, userId, resolveListId(meta, listIdInput));
  if (!stored) return { importedAt: null, skipped: 0, items: [] };
  // CROSS JOIN pins json_each as the outer loop, so every link is one lookup in the
  // (user_id,platform,normalized_link) unique index. A plain JOIN let SQLite scan all of the owner's
  // Telegram chats once per link: millions of D1 rows read per call on real data.
  const statuses = await db.prepare(`SELECT c.normalized_link AS link,c.workflow_status AS status,c.telegram_account_id AS account_id
    FROM json_each(?2) j CROSS JOIN chats c ON c.user_id=?1 AND c.platform='telegram' AND c.normalized_link=j.value`)
    .bind(userId, JSON.stringify(stored.items.map(item => item.link))).all<{ link: string; status: string; account_id: string | null }>();
  const statusByLink = new Map(statuses.results.map(item => [item.link, item]));
  const items = stored.items
    .map(item => ({ ...item, status: statusByLink.get(item.link)?.status ?? null, accountId: statusByLink.get(item.link)?.account_id ?? null }))
    .sort((a, b) => b.count - a.count || (b.last ?? '').localeCompare(a.last ?? '') || a.title.localeCompare(b.title, 'uk'));
  return { importedAt: stored.importedAt ?? null, skipped: stored.skipped ?? 0, items };
}

// One selected chat into «Для приєднання». The bulk flow scans every chat of the platform twice
// (preview + add) to catch legacy non-canonical links; here the link is canonical from the import,
// so the unique (user_id,platform,normalized_link) index alone guards against duplicates.
export async function addSelectedChatToJoin(db: D1Database, userId: string, link: unknown, now: number, listIdInput?: unknown) {
  const { meta } = await readMeta(db, userId);
  const stored = await readStored(db, userId, resolveListId(meta, listIdInput));
  const item = typeof link === 'string' ? stored?.items.find(entry => entry.link === link) : undefined;
  if (!item) throw new SelectedChatsError('Цього чату немає серед відібраних. Оновіть сторінку.', 404);
  const normalized = normalizeGroupLink(item.link);
  if (!normalized || normalized.platform !== 'telegram') throw new SelectedChatsError('Некоректне посилання чату.');
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
    VALUES (?1,?2,'telegram',?3,?4,?4,'to_join',?5,?6,?6)
    ON CONFLICT(user_id,platform,normalized_link) DO NOTHING RETURNING id`)
    .bind(id, userId, item.title, normalized.link, Number(normalized.private), now).all<{ id: string }>();
  const added = inserted.results.length === 1;
  if (added) {
    await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,occurred_at,event_date,metadata_json,source_key)
      VALUES (?1,?2,'chat_bulk_added',?3,?4,?5,?6)`)
      .bind(crypto.randomUUID(), userId, now, businessDate(now),
        JSON.stringify({ source: 'telegram_selected', result: { added: 1, counts: { telegram: 1 } }, chatIds: [id] }), `chat-selected:${id}`).run();
  }
  const row = await db.prepare(`SELECT workflow_status,telegram_account_id FROM chats WHERE user_id=?1 AND platform='telegram' AND normalized_link=?2 LIMIT 1`)
    .bind(userId, normalized.link).first<{ workflow_status: string; telegram_account_id: string | null }>();
  return { added, status: row?.workflow_status ?? null, accountId: row?.telegram_account_id ?? null };
}

export const SELECTED_BULK_ADD_MAX = 50;

// The N most active selected chats that are not in Work OS yet go into «Для приєднання» in one batch.
export async function addTopSelectedChatsToJoin(db: D1Database, userId: string, countInput: unknown, now: number, listIdInput?: unknown) {
  const count = Math.floor(Number(countInput));
  if (!Number.isSafeInteger(count) || count < 1 || count > SELECTED_BULK_ADD_MAX) {
    throw new SelectedChatsError(`Можна додати від 1 до ${SELECTED_BULK_ADD_MAX} чатів за раз.`);
  }
  const view = await readSelectedChats(db, userId, listIdInput);
  const picked = view.items.filter(item => item.status === null).slice(0, count)
    .flatMap(item => {
      const normalized = normalizeGroupLink(item.link);
      return normalized && normalized.platform === 'telegram' ? [{ id: crypto.randomUUID(), item, normalized }] : [];
    });
  if (!picked.length) return { added: 0, links: [] as string[] };
  const results = await db.batch(picked.map(({ id, item, normalized }) => db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
    VALUES (?1,?2,'telegram',?3,?4,?4,'to_join',?5,?6,?6)
    ON CONFLICT(user_id,platform,normalized_link) DO NOTHING RETURNING id`)
    .bind(id, userId, item.title, normalized.link, Number(normalized.private), now)));
  const added = picked.filter((_, index) => results[index].results.length === 1);
  if (added.length) {
    await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,occurred_at,event_date,metadata_json,source_key)
      VALUES (?1,?2,'chat_bulk_added',?3,?4,?5,?6)`)
      .bind(crypto.randomUUID(), userId, now, businessDate(now),
        JSON.stringify({ source: 'telegram_selected', result: { added: added.length, counts: { telegram: added.length } }, chatIds: added.map(entry => entry.id) }),
        `chat-selected-top:${added[0].id}`).run();
  }
  return { added: added.length, links: added.map(entry => entry.normalized.link) };
}
