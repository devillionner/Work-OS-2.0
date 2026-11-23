/**
 * Оголошення Бібліотеки для автопосту (3.20.0): спільний вибір для Viber, WhatsApp і Telegram, правило «яке оголошення підходить чату» й
 * детермінований розподіл по чатах партії. Правило (`adFitsChat`) одне: за ним рахують план, партія, видача задачі й перегляд, тож вони не розходяться.
 */
import { canonicalDirection, canonicalDirections } from './directions.ts';
import { DICTIONARY_SETTING_KEY, isStandardDirection, parseDictionaries } from './library-dictionaries.ts';

export type AdScope = 'wide' | 'exclusive';
export const cleanAdScope = (value: unknown): AdScope => (value === 'exclusive' ? 'exclusive' : 'wide');

export type LibraryAd = {
  id: string; version: number; title: string; scope: AdScope;
  /** Напрями оголошення: теги, що є в довіднику «Напрямки» (канонічні). */
  directions: string[];
  ukText: string; ruText: string;
  /** Хеш фото оголошення (порожньо — фото немає). */
  imageKey: string | null;
  updatedAt: number;
};

/** Ключ у `user_settings`, де лежать байти фото оголошення. */
export const adImageSettingKey = (id: string) => `library_ad_image_v1:${id}`;

/** Тексти пулу Telegram (`tgp_`) не оголошення Бібліотеки: діапазон по первинному ключу (як `POOL_ID_RANGE`). */
const POOL_ID_RANGE_SQL = `id>='tgp_' AND id<'tgp\`'`;

const same = (left: string, right: string) => canonicalDirection(left).toLocaleLowerCase('uk-UA') === canonicalDirection(right).toLocaleLowerCase('uk-UA');
const hasShared = (left: readonly string[], right: readonly string[]) => left.some((item) => right.some((other) => same(item, other)));

/** Чи має оголошення спільний напрям із чатом. */
export const adSharesDirection = (ad: { directions: readonly string[] }, chat: { directions: readonly string[] }) => hasShared(ad.directions, chat.directions);

/**
 * Чи підходить оголошення чату.
 * · чат без напрямів: лише «широке»;
 * · чат з напрямами: «широке» (будь-яке) або оголошення зі спільним напрямом; «лише свій напрям» без збігу не підходить;
 * · суворий чат («Лише ці напрямки»): лише оголошення зі спільним напрямом (широке чи ні);
 * · «широке» без напрямів іде в усі чати, крім суворих; «лише свій напрям» без напрямів не йде нікуди.
 */
export function adFitsChat(ad: { scope: AdScope; directions: readonly string[] }, chat: { directions: readonly string[]; strict: boolean }): boolean {
  if (!chat.directions.length) return ad.scope === 'wide';
  const overlap = adSharesDirection(ad, chat);
  if (chat.strict) return overlap;
  return ad.scope === 'wide' || overlap;
}

/** Напрями оголошення за його тегами: лише ті, що є в довіднику «Напрямки» (збережений довідник і стандартні предмети). */
export function adDirectionsFromTags(tags: readonly string[], dictionaryDirections: readonly string[]): string[] {
  const known = new Set(dictionaryDirections.map((name) => name.toLocaleLowerCase('uk-UA')));
  return canonicalDirections(tags.filter((tag) => known.has(tag.toLocaleLowerCase('uk-UA')) || isStandardDirection(tag)));
}

export type AdChat = {
  id: string; language: 'uk' | 'ru' | null; directions: string[]; strict: boolean;
  /** Коли кожне з обраних оголошень востаннє виходило в цьому чаті (день), якщо виходило. */
  last: ReadonlyMap<string, string>;
};
export type AdAssignment = { chatId: string; ad: LibraryAd; language: 'uk' | 'ru'; text: string; matched: boolean };

/** Мова тексту: мова чату, а коли такого тексту немає, інша. */
function textFor(ad: LibraryAd, language: 'uk' | 'ru' | null): { language: 'uk' | 'ru'; text: string } | null {
  const uk = ad.ukText.trim(); const ru = ad.ruText.trim();
  const wanted = language ?? 'uk';
  if (wanted === 'ru' && ru) return { language: 'ru', text: ru };
  if (wanted === 'uk' && uk) return { language: 'uk', text: uk };
  if (uk) return { language: 'uk', text: uk };
  if (ru) return { language: 'ru', text: ru };
  return null;
}

/**
 * Розподіл обраних оголошень по чатах у порядку відправки. Для кожного чату кандидати — обрані, що підходять (`adFitsChat`). Пріоритет:
 * 1) напрям оголошення збігся з напрямом чату; 2) те, якого в цьому чаті найдовше не було; 3) те, що менше взято в цій партії; 4) стабільний id.
 * Чисто детермінована, без бази: перегляд збігається із запуском.
 */
export function assignLibraryAds(chats: readonly AdChat[], ads: readonly LibraryAd[]): { assigned: Map<string, AdAssignment>; none: string[] } {
  const used = new Map<string, number>();
  const assigned = new Map<string, AdAssignment>();
  const none: string[] = [];
  for (const chat of chats) {
    let best: { ad: LibraryAd; matched: boolean; last: string; taken: number; text: { language: 'uk' | 'ru'; text: string } } | null = null;
    for (const ad of ads) {
      if (!adFitsChat(ad, chat)) continue;
      const text = textFor(ad, chat.language);
      if (!text) continue;
      const candidate = { ad, matched: chat.directions.length > 0 && adSharesDirection(ad, chat), last: chat.last.get(ad.id) ?? '', taken: used.get(ad.id) ?? 0, text };
      if (!best) { best = candidate; continue; }
      if (candidate.matched !== best.matched) { if (candidate.matched) best = candidate; continue; }
      if (candidate.last !== best.last) { if (candidate.last < best.last) best = candidate; continue; }
      if (candidate.taken !== best.taken) { if (candidate.taken < best.taken) best = candidate; continue; }
      if (candidate.ad.id < best.ad.id) best = candidate;
    }
    if (!best) { none.push(chat.id); continue; }
    used.set(best.ad.id, (used.get(best.ad.id) ?? 0) + 1);
    assigned.set(chat.id, { chatId: chat.id, ad: best.ad, language: best.text.language, text: best.text.text, matched: best.matched });
  }
  return { assigned, none };
}

/** Чому чату не підійшло жодне з обраних: «напрям чату: X; обрані: Y, Z» чи «чат без напряму, а обрані лише для свого напряму». */
export function noAdReason(chat: { directions: readonly string[]; strict: boolean }, ads: readonly Pick<LibraryAd, 'title'>[]): string {
  const chosen = ads.map((ad) => ad.title).join(', ');
  if (!chat.directions.length) return `чат без напряму, а обрані лише для свого напряму: ${chosen}`;
  return `напрям чату: ${chat.directions.join(', ')}${chat.strict ? ' (лише він)' : ''}; обрані: ${chosen}`;
}

// ---------------------------------------------------------------- Зберігання

const ADS_KEY = 'autopost_ads_v1';
const SHARED_SOURCE_KEY = 'autopost_shared_source_v1';
export type SharedSource = 'library' | 'own';

/** Вибір оголошень (один для Viber, WhatsApp і Telegram). */
export async function readSelectedAdIds(db: D1Database, userId: string): Promise<string[]> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, ADS_KEY).first<{ value_json: string }>();
  try {
    const value = row ? (JSON.parse(row.value_json) as { ids?: unknown }) : null;
    return Array.isArray(value?.ids) ? [...new Set(value.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, 100) : [];
  } catch { return []; }
}

export async function saveSelectedAdIds(db: D1Database, userId: string, ids: readonly string[], now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(userId, ADS_KEY, JSON.stringify({ ids }), now).run();
}

/** Режим WhatsApp і Viber: збережений вибір («Оголошення з Бібліотеки» чи «Власний текст і фото»); без вибору діє власний матеріал, як було. */
export async function readSharedSource(db: D1Database, userId: string): Promise<SharedSource | null> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, SHARED_SOURCE_KEY).first<{ value_json: string }>();
  try { const value: unknown = row ? JSON.parse(row.value_json) : null; return value === 'library' || value === 'own' ? value : null; } catch { return null; }
}

export async function saveSharedSource(db: D1Database, userId: string, mode: SharedSource, now: number) {
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
    ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(userId, SHARED_SOURCE_KEY, JSON.stringify(mode), now).run();
}

type AdRow = { id: string; version: number; title: string; uk_text: string; ru_text: string; tags_json: string; platforms_json: string; scope: string | null; image_key: string | null; updated_at: number };
const list = (value: string): string[] => { try { const parsed: unknown = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };

/** Напрями, які в довіднику: збережений довідник користувача (стандартні предмети додаються окремо). */
export async function readDictionaryDirections(db: D1Database, userId: string): Promise<string[]> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`).bind(userId, DICTIONARY_SETTING_KEY).first<{ value_json: string }>();
  return parseDictionaries(row?.value_json)?.directions ?? [];
}

/**
 * Усі неархівні оголошення Бібліотеки для платформи (без системних і без текстів пулу Telegram). Читається один запит по індексу колекції
 * (`library_items_user_collection_idx`), рядків стільки, скільки оголошень (десятки); `directions` рахується за довідником.
 */
export async function readLibraryAds(db: D1Database, userId: string, platform: 'whatsapp' | 'viber' | 'telegram'): Promise<LibraryAd[]> {
  const [rows, dictionary] = await Promise.all([
    db.prepare(`SELECT id,version,title,uk_text,ru_text,tags_json,platforms_json,scope,image_key,updated_at FROM library_items
      WHERE user_id=?1 AND collection='advertisement' AND archived_at IS NULL AND NOT (${POOL_ID_RANGE_SQL}) AND tags_json NOT LIKE '%"system"%'
      ORDER BY updated_at DESC,title LIMIT 300`).bind(userId).all<AdRow>(),
    readDictionaryDirections(db, userId),
  ]);
  const ads: LibraryAd[] = [];
  for (const row of rows.results || []) {
    const platforms = list(row.platforms_json);
    if (platforms.length && !platforms.some((value) => value.trim().toLocaleLowerCase('uk-UA') === platform)) continue;
    ads.push({ id: row.id, version: Number(row.version), title: row.title, scope: cleanAdScope(row.scope), directions: adDirectionsFromTags(list(row.tags_json), dictionary), ukText: row.uk_text, ruText: row.ru_text, imageKey: row.image_key || null, updatedAt: Number(row.updated_at) || 0 });
  }
  return ads;
}

/** Скільки днів назад дивимось, коли оголошення востаннє виходило в чаті (діапазон по індексу чат+день): далі вважаємо «давно не було». 14 днів, як у пулі Telegram, щоб читання на партію лишалось у кілька тисяч рядків. */
const LAST_WINDOW_DAYS = 14;
function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

/**
 * Коли обрані оголошення востаннє виходили в чатах: `json_each` по чатах, публікації — діапазон індексу `(chat_id, published_on)` за останні 14 днів
 * (не більше одного рядка за добу на чат), без скану історії.
 */
export async function readAdLastPublished(db: D1Database, userId: string, chatIds: readonly string[], adIds: readonly string[], date: string): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  if (!chatIds.length || !adIds.length) return result;
  const rows = await db.prepare(`SELECT p.chat_id AS chat_id,p.advertisement_id AS ad,MAX(p.published_on) AS day
    FROM json_each(?2) e CROSS JOIN chat_publications p ON p.chat_id=e.value AND p.published_on>=?4
    WHERE p.user_id=?1 AND p.advertisement_id IN (SELECT value FROM json_each(?3))
    GROUP BY p.chat_id,p.advertisement_id`).bind(userId, JSON.stringify(chatIds), JSON.stringify(adIds), daysBefore(date, LAST_WINDOW_DAYS)).all<{ chat_id: string; ad: string; day: string }>();
  for (const row of rows.results || []) {
    const map = result.get(row.chat_id) ?? new Map<string, string>();
    map.set(row.ad, row.day);
    result.set(row.chat_id, map);
  }
  return result;
}
