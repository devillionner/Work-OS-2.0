/**
 * Пул текстових оголошень автопосту Telegram. Тексти лежать у `library_items` (kind='advertisement', id з префіксом `tgp_`,
 * тег `tg-pool`, платформа telegram), розмітка — JSON у `notes`. Окремої таблиці немає: задача автопосту вже несе
 * advertisement_id + payload_text, а зв'язок із публікаціями (`chat_publications.advertisement_id`) і зовнішні ключі працюють як є.
 * Активний пул — неархівовані записи; «Замінити» архівує попередній, «Додати» дописує.
 */
import { canonicalDirection } from '../directions.ts';
import { poolGrams, findDuplicate, poolSnippet, POOL_TEXT_LIMIT, type PoolAudience, type PoolLanguage } from './parse.ts';
import { readSavedSource } from './source.ts';
import { assignPoolTexts, chatAudience, type PoolAssignment, type PoolChat, type PoolText } from './assign.ts';

export const POOL_ID_PREFIX = 'tgp_';
/** Діапазон первинного ключа `tgp_…`: SQLite бере його по індексу, на відміну від LIKE з ESCAPE. */
export const POOL_ID_RANGE = `id>='tgp_' AND id<'tgp\`'`;
export const isPoolId = (id: string) => id.startsWith(POOL_ID_PREFIX);
/** Коди, після яких повідомлення могло піти в чат: текст лишається зайнятим, навіть якщо підтвердження немає. */
export const POOL_SENT_UNCONFIRMED = ['send_not_confirmed', 'helper_timeout', 'media_send_not_confirmed', 'publication_reconcile_failed'] as const;
const RECENT_DAYS = 14;
const MAX_SAVE = 500;

type PoolRow = { id: string; version: number; title: string; uk_text: string; ru_text: string; notes: string; created_at: number };

export type PoolSaveItem = { text: string; direction: string; audience: PoolAudience; language: PoolLanguage; until: string | null; author: string };

function parseNotes(value: string): { direction: string; audience: PoolAudience; language: PoolLanguage; until: string | null; author: string; usedOn: string | null } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      direction: typeof parsed.direction === 'string' ? parsed.direction : '',
      audience: parsed.audience === 'kids' || parsed.audience === 'adults' ? parsed.audience : 'any',
      language: parsed.language === 'ru' ? 'ru' : 'uk',
      until: typeof parsed.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.until) ? parsed.until : null,
      author: typeof parsed.author === 'string' ? parsed.author : '',
      usedOn: typeof parsed.usedOn === 'string' ? parsed.usedOn : null,
    };
  } catch { return { direction: '', audience: 'any', language: 'uk', until: null, author: '', usedOn: null }; }
}
function toText(row: PoolRow): PoolText {
  const notes = parseNotes(row.notes);
  const text = notes.language === 'ru' ? (row.ru_text || row.uk_text) : (row.uk_text || row.ru_text);
  return { id: row.id, version: Number(row.version) || 1, text, language: notes.language, direction: notes.direction, audience: notes.audience, until: notes.until, author: notes.author, usedOn: notes.usedOn };
}

/** Усі активні тексти пулу (термін актуальності не відсіюється: його перевіряє той, хто підбирає). Через індекс (user_id, kind, archived_at): архівні пули не читаються. */
export async function readActivePool(db: D1Database, userId: string): Promise<PoolText[]> {
  const rows = await db.prepare(`SELECT id,version,title,uk_text,ru_text,notes,created_at FROM library_items
    WHERE user_id=?1 AND kind='advertisement' AND archived_at IS NULL AND ${POOL_ID_RANGE} ORDER BY created_at,rowid`).bind(userId).all<PoolRow>();
  return (rows.results || []).map(toText);
}

/** Тексти пулу, зайняті задачами Telegram за добу: в роботі, відправлені й відправлені без підтвердження (невдачі до відправки текст не займають). */
export async function readOccupiedPoolIds(db: D1Database, userId: string, date: string, excludeJobId = ''): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT advertisement_id AS id,status,json_extract(result_json,'$.errorCode') AS code
    FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND platform='telegram' AND published_on=?2 AND advertisement_id>='tgp_' AND advertisement_id<'tgp\`'
      AND status IN ('pending','claimed','sent','failed') AND substr(request_key,1,5)<>'scan_' AND (?3='' OR id<>?3)`).bind(userId, date, excludeJobId).all<{ id: string; status: string; code: string | null }>();
  const taken = new Set<string>();
  for (const row of rows.results || []) {
    if (row.status !== 'failed' || (row.code && (POOL_SENT_UNCONFIRMED as readonly string[]).includes(row.code))) taken.add(row.id);
  }
  return taken;
}

export type PoolState = { items: PoolText[]; taken: Set<string>; active: boolean; date: string };
export async function readPoolState(db: D1Database, userId: string, date: string, excludeJobId = ''): Promise<PoolState> {
  const items = await readActivePool(db, userId);
  const taken = items.length ? await readOccupiedPoolIds(db, userId, date, excludeJobId) : new Set<string>();
  for (const item of items) if (item.usedOn === date) taken.add(item.id);
  return { items, taken, active: items.length > 0, date };
}

export type PoolSummary = {
  /** Скільки текстів у пулі (з терміном, що ще не минув) і скільки з них вільні сьогодні. */
  total: number; free: number; expired: number;
  /** Напрями, де вільних текстів менше, ніж чатів, що їх потребують (або лишилось два й менше). */
  ending: string[];
  byDirection: Array<{ direction: string; total: number; free: number }>;
};
export function summarizePool(state: PoolState, demand: ReadonlyMap<string, number> = new Map()): PoolSummary {
  const live = state.items.filter((item) => !item.until || item.until >= state.date);
  const by = new Map<string, { total: number; free: number }>();
  for (const item of live) {
    const key = item.direction ? canonicalDirection(item.direction) : '';
    const entry = by.get(key) ?? { total: 0, free: 0 };
    entry.total += 1;
    if (!state.taken.has(item.id)) entry.free += 1;
    by.set(key, entry);
  }
  const ending: string[] = [];
  for (const [direction, entry] of by) {
    if (!direction) continue;
    const need = demand.get(direction.toLocaleLowerCase('uk-UA')) ?? 0;
    if (entry.free < need || (entry.free <= 2 && need > 0)) ending.push(direction);
  }
  return {
    total: live.length, free: live.filter((item) => !state.taken.has(item.id)).length, expired: state.items.length - live.length,
    ending, byDirection: [...by].map(([direction, entry]) => ({ direction, ...entry })).sort((a, b) => b.total - a.total),
  };
}

const hasPinned = (value: string | null) => { try { const parsed: unknown = JSON.parse(value || '[]'); return Array.isArray(parsed) && parsed.some((item) => typeof item === 'string' && item); } catch { return false; } };

/** Чати для підбору: мова й напрями профілю, назва, тексти пулу, що виходили в чаті останні 14 днів. */
export async function readPoolChats(db: D1Database, userId: string, chatIds: readonly string[], date: string): Promise<PoolChat[]> {
  if (!chatIds.length) return [];
  const ids = JSON.stringify(chatIds);
  const since = new Date(Date.parse(`${date}T00:00:00Z`) - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const [chats, recent] = await Promise.all([
    db.prepare(`SELECT c.id AS id,c.name AS name,p.language AS language,p.directions_json AS directions,p.directions_strict AS strict,p.pinned_ads_json AS pinned
      FROM chats c INDEXED BY sqlite_autoindex_chats_1 LEFT JOIN chat_profiles p ON p.chat_id=c.id
      WHERE c.user_id=?1 AND c.id IN (SELECT value FROM json_each(?2))`).bind(userId, ids).all<{ id: string; name: string; language: string | null; directions: string | null; strict: number | null; pinned: string | null }>(),
    db.prepare(`SELECT j.value AS chat_id,p.advertisement_id AS ad
      FROM json_each(?1) j CROSS JOIN chat_publications p INDEXED BY chat_publications_chat_date_idx ON p.chat_id=j.value AND p.published_on>=?2
      WHERE p.advertisement_id>='tgp_' AND p.advertisement_id<'tgp\`'`).bind(ids, since).all<{ chat_id: string; ad: string }>(),
  ]);
  const seen = new Map<string, Set<string>>();
  for (const row of recent.results || []) { const set = seen.get(row.chat_id) ?? new Set<string>(); set.add(row.ad); seen.set(row.chat_id, set); }
  const byId = new Map((chats.results || []).map((row) => [row.id, row]));
  return chatIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    let directions: string[] = [];
    try { const parsed = JSON.parse(row.directions || '[]') as unknown; directions = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => canonicalDirection(item)).filter(Boolean) : []; } catch { /* профіль без напрямів */ }
    // Чат із закріпленими оголошеннями (`Лише ці оголошення`) бере їх сам (`createWhatsAppAutopostJob`): у розкладку пулу він не входить.
    if (hasPinned(row.pinned)) return [];
    return [{ id, name: row.name, language: row.language === 'ru' ? 'ru' as const : row.language === 'uk' ? 'uk' as const : null, directions, strict: Number(row.strict) === 1 && directions.length > 0, recent: seen.get(id) ?? new Set<string>() }];
  });
}

/** Підбір для групи чатів однією жадібною розкладкою. `forced` — ручний вибір «Змінити» (чат → id тексту). */
export async function resolvePoolAssignments(db: D1Database, userId: string, chatIds: readonly string[], date: string, options: { forced?: ReadonlyMap<string, string>; state?: PoolState; excludeJobId?: string } = {}) {
  const state = options.state ?? await readPoolState(db, userId, date, options.excludeJobId ?? '');
  const chats = await readPoolChats(db, userId, chatIds, date);
  const result = assignPoolTexts(chats, state.items, { taken: state.taken, today: date, forced: options.forced });
  return { state, ...result, chats };
}

/** Один чат: вільний текст пулу, що найкраще підходить (задача створюється поза партією: «Спробувати ще», після проходу гілок). */
export async function pickPoolTextForChat(db: D1Database, userId: string, chatId: string, date: string, excludeJobId = ''): Promise<{ active: boolean; pick: PoolAssignment | null }> {
  // Власник вибрав власний матеріал: пул не використовується й не витрачається.
  if ((await readSavedSource(db, userId)) === 'own') return { active: false, pick: null };
  const state = await readPoolState(db, userId, date, excludeJobId);
  if (!state.active) return { active: false, pick: null };
  const { assigned } = await resolvePoolAssignments(db, userId, [chatId], date, { state });
  return { active: true, pick: assigned.get(chatId) ?? null };
}

/** На claim: чи текст усе ще вільний (його не взяла інша задача); якщо ні — наступний найкращий вільний для цього чату, `null` — вільних немає. */
export async function confirmPoolText(db: D1Database, userId: string, job: { id: string; chat_id: string; advertisement_id: string }, date: string): Promise<{ same: true } | { same: false; pick: PoolAssignment | null }> {
  const other = await db.prepare(`SELECT 1 AS hit FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND platform='telegram' AND published_on=?2 AND advertisement_id=?3 AND id<>?4
      AND (status IN ('claimed','sent') OR (status='failed' AND json_extract(result_json,'$.errorCode') IN ('send_not_confirmed','helper_timeout','media_send_not_confirmed','publication_reconcile_failed')))
    LIMIT 1`).bind(userId, date, job.advertisement_id, job.id).first<{ hit: number }>();
  if (!other) return { same: true };
  const { pick } = await pickPoolTextForChat(db, userId, job.chat_id, date, job.id);
  return { same: false, pick };
}

function cleanItem(item: unknown): PoolSaveItem | null {
  if (!item || typeof item !== 'object') return null;
  const value = item as Record<string, unknown>;
  const text = typeof value.text === 'string' ? value.text.replace(/\r\n?/g, '\n').replace(/�+[ \t]*/gu, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (!text || Array.from(text).length > POOL_TEXT_LIMIT) return null;
  const direction = typeof value.direction === 'string' && value.direction.trim() ? canonicalDirection(value.direction.trim()).slice(0, 60) : '';
  const until = typeof value.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.until) && !Number.isNaN(Date.parse(`${value.until}T00:00:00Z`)) ? value.until : null;
  return {
    text, direction,
    audience: value.audience === 'kids' || value.audience === 'adults' ? value.audience : 'any',
    language: value.language === 'ru' ? 'ru' : 'uk',
    until,
    author: typeof value.author === 'string' ? Array.from(value.author.trim()).slice(0, 40).join('') : '',
  };
}

/**
 * Зберігає список. `replace` — новий пул: тексти, яких у списку вже немає, потрапляють в архів, а тексти, що збігаються з наявними
 * дослівно, лишаються тими самими записами (їхні розмітка оновлюється; так не губиться «сьогодні вже використано» й історія чатів, а
 * бібліотека не росте щоразу, коли власник вставляє список, де більшість текстів ті самі). `add` дописує; тексти, схожі на наявні
 * на ≥ 90 %, пропускаються.
 */
export async function savePool(db: D1Database, userId: string, input: { mode: 'replace' | 'add'; items: unknown }, now: number, date: string): Promise<{ saved: number; skipped: number; archived: number; kept: number }> {
  const raw = Array.isArray(input.items) ? input.items.slice(0, MAX_SAVE) : [];
  const cleaned = raw.map(cleanItem).filter((item): item is PoolSaveItem => item !== null);
  const active = await readActivePool(db, userId);
  const activeByKey = new Map(active.map((item) => [poolGrams(item.text).key, item]));
  const known: Array<{ key: string; grams: Set<string> }> = [];
  if (input.mode === 'add') for (const item of active) known.push(poolGrams(item.text));
  const accepted: Array<{ item: PoolSaveItem; key: string; existing: PoolText | null }> = [];
  const seen = new Set<string>();
  for (const item of cleaned) {
    const { key, grams } = poolGrams(item.text);
    if (seen.has(key)) continue;
    if (input.mode === 'add') { if (findDuplicate(key, grams, known)) continue; known.push({ key, grams }); }
    seen.add(key);
    accepted.push({ item, key, existing: input.mode === 'replace' ? activeByKey.get(key) ?? null : null });
  }
  // Текст, який сьогодні вже виходив (хай і з пулу, що вже в архіві), після заміни списку не видається вдруге: його позначено використаним на сьогодні.
  const usedToday: Array<{ key: string; grams: Set<string> }> = [];
  const today = await db.prepare(`SELECT payload_text,status,json_extract(result_json,'$.errorCode') AS code FROM whatsapp_autopost_jobs
    WHERE user_id=?1 AND platform='telegram' AND published_on=?2 AND advertisement_id>='tgp_' AND advertisement_id<'tgp\`'
      AND status IN ('pending','claimed','sent','failed') AND substr(request_key,1,5)<>'scan_'`).bind(userId, date).all<{ payload_text: string; status: string; code: string | null }>();
  for (const row of today.results || []) {
    if (row.status === 'failed' && !(row.code && (POOL_SENT_UNCONFIRMED as readonly string[]).includes(row.code))) continue;
    usedToday.push(poolGrams(row.payload_text));
  }
  const isUsedToday = (text: string) => { const { key, grams } = poolGrams(text); return findDuplicate(key, grams, usedToday) !== null; };
  const notesOf = (item: PoolSaveItem, usedOn: string | null) => JSON.stringify({ v: 1, direction: item.direction, audience: item.audience, language: item.language, until: item.until, author: item.author, ...(usedOn ? { usedOn } : {}) });

  const statements: D1PreparedStatement[] = [];
  const kept = new Set<string>();
  let archived = 0;
  for (const entry of accepted) {
    if (entry.existing) {
      kept.add(entry.existing.id);
      statements.push(db.prepare(`UPDATE library_items SET notes=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(notesOf(entry.item, entry.existing.usedOn ?? null), now, entry.existing.id, userId));
    } else {
      statements.push(db.prepare(`INSERT INTO library_items
        (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at)
        VALUES (?1,?2,'advertisement','advertisement',1,?3,?4,?5,?6,'["tg-pool"]','["telegram"]',NULL,?7,?7)`)
        .bind(`${POOL_ID_PREFIX}${crypto.randomUUID()}`, userId, poolSnippet(entry.item.text, 80), entry.item.language === 'uk' ? entry.item.text : '', entry.item.language === 'ru' ? entry.item.text : '',
          notesOf(entry.item, isUsedToday(entry.item.text) ? date : null), now));
    }
  }
  if (input.mode === 'replace') {
    for (const item of active) {
      if (kept.has(item.id)) continue;
      archived += 1;
      statements.push(db.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3 AND archived_at IS NULL`).bind(now, item.id, userId));
    }
  }
  // Пакетами по 100 записів: пул або оновлюється разом, або (при збої на першому пакеті) лишається як був.
  for (let at = 0; at < statements.length; at += 100) await db.batch(statements.slice(at, at + 100));
  // Архівні тексти попередніх пулів, які жодна задача не використала, прибираються (інакше бібліотека росла б із кожною заміною).
  if (input.mode === 'replace') {
    try {
      await db.prepare(`DELETE FROM library_items WHERE user_id=?1 AND archived_at IS NOT NULL AND archived_at<?2 AND ${POOL_ID_RANGE}
        AND NOT EXISTS(SELECT 1 FROM whatsapp_autopost_jobs j WHERE j.advertisement_id=library_items.id)`).bind(userId, now - 2 * 86400).run();
    } catch { /* чистка не критична: пул уже збережено */ }
  }
  return { saved: accepted.length, skipped: cleaned.length - accepted.length + (raw.length - cleaned.length), archived, kept: kept.size };
}

/** Тексти пулу для перегляду: з позначкою «вільний сьогодні» (взяті задачами Telegram за добу — ні). */
export async function readPoolForUi(db: D1Database, userId: string, date: string) {
  const state = await readPoolState(db, userId, date);
  const summary = summarizePool(state);
  return {
    summary,
    items: state.items.map((item) => ({
      id: item.id, text: item.text, snippet: poolSnippet(item.text, 80), language: item.language, direction: item.direction, audience: item.audience, until: item.until, author: item.author,
      expired: Boolean(item.until && item.until < date), free: !state.taken.has(item.id) && !(item.until && item.until < date),
    })),
  };
}
export { chatAudience };
