// Автопост Telegram через браузер: гілки форумів, прив'язка акаунта Telegram Web і дані для задачі. Спільна черга задач, claim і
// політика збоїв живуть у messenger-automation.ts; тут лише те, що стосується тільки Telegram.

export type TelegramTopic = { id: string; title: string; closed: boolean };
export type TelegramThread = { id: string; title: string };
/**
 * Що runner бачив у чаті: чи це форум і які в ньому гілки (закриті позначені, писати в них не можна). `restricted` — тимчасова заборона писати
 * в чат узагалі (нічний режим бота, повільний режим, права чату): true ставить позначку, false знімає, відсутнє не чіпає.
 */
export type TelegramScan = { forum: boolean; topics: TelegramTopic[]; restricted?: boolean };

export class TelegramAutopostError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 409, code = 'telegram_rejected') { super(message); this.name = 'TelegramAutopostError'; this.status = status; this.code = code; }
}

const MAX_TOPICS = 200;
const THREAD_ID = /^[0-9]{1,18}$/;

function cleanTitle(value: unknown, max = 120) {
  if (typeof value !== 'string') return '';
  return value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().normalize('NFC').slice(0, max);
}

/** Список гілок із відповіді runner або з бази: лише коректні записи, без повторів. */
export function parseTelegramTopics(value: unknown): TelegramTopic[] {
  let source: unknown = value;
  if (typeof value === 'string') { try { source = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const topics: TelegramTopic[] = [];
  for (const item of source.slice(0, MAX_TOPICS)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { id?: unknown; title?: unknown; closed?: unknown };
    const id = typeof raw.id === 'number' ? String(raw.id) : typeof raw.id === 'string' ? raw.id.trim() : '';
    const title = cleanTitle(raw.title);
    if (!THREAD_ID.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    topics.push({ id, title, closed: raw.closed === true });
  }
  return topics;
}

export function parseTelegramScan(value: unknown): TelegramScan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { forum?: unknown; topics?: unknown; restricted?: unknown };
  if (typeof raw.forum !== 'boolean') return null;
  return { forum: raw.forum, topics: raw.forum ? parseTelegramTopics(raw.topics) : [], ...(typeof raw.restricted === 'boolean' ? { restricted: raw.restricted } : {}) };
}

type ThreadRow = { telegram_forum: number | null; telegram_thread_id: string | null; telegram_thread_title: string | null; telegram_topics_json: string | null; telegram_topics_at: number | null };

export type TelegramThreadState = { forum: boolean | null; thread: TelegramThread | null; topics: TelegramTopic[]; scannedAt: number | null };

function threadState(row: ThreadRow | null): TelegramThreadState {
  if (!row) return { forum: null, thread: null, topics: [], scannedAt: null };
  return {
    forum: row.telegram_forum === null ? null : row.telegram_forum === 1,
    thread: row.telegram_thread_id ? { id: row.telegram_thread_id, title: row.telegram_thread_title || '' } : null,
    topics: parseTelegramTopics(row.telegram_topics_json),
    scannedAt: row.telegram_topics_at === null ? null : Number(row.telegram_topics_at),
  };
}

export async function readTelegramThreadState(db: D1Database, userId: string, chatId: string): Promise<TelegramThreadState> {
  const row = await db.prepare(`SELECT telegram_forum,telegram_thread_id,telegram_thread_title,telegram_topics_json,telegram_topics_at
    FROM chats WHERE id=?1 AND user_id=?2 AND platform='telegram' LIMIT 1`).bind(chatId, userId).first<ThreadRow>();
  return threadState(row);
}

/**
 * Runner відкрив чат і побачив, форум це чи ні та які в ньому гілки. Збережена гілка, яка зникла або стала закритою, скидається:
 * публікувати в неї не можна, власник вибирає знову. `updated_at` чату не чіпаємо, щоб задачі в черзі не вважали чат зміненим.
 */
export async function applyTelegramScan(db: D1Database, userId: string, chatId: string, scan: TelegramScan, now: number) {
  const current = await readTelegramThreadState(db, userId, chatId);
  // Прохід гілок має бюджет часу й часто бачить лише частину списку: нове доповнює збережене (за id), а не затирає його.
  const merged = new Map<string, TelegramTopic>();
  if (scan.forum) {
    for (const topic of current.topics) merged.set(topic.id, topic);
    for (const topic of scan.topics) merged.set(topic.id, topic);
  }
  const topics = [...merged.values()];
  let threadId = current.thread?.id ?? null;
  let threadTitle = current.thread?.title ?? null;
  if (!scan.forum) { threadId = null; threadTitle = null; }
  else if (threadId) {
    const topic = merged.get(threadId);
    if (topic?.closed) { threadId = null; threadTitle = null; }
    else if (topic) threadTitle = topic.title;
  }
  // Позначка «зараз писати не можна»: true — ставимо час першого виявлення (не перезаписуємо: за ним рахується тиждень до архіву «Забанено»),
  // false — знімаємо, не передано — лишаємо як є.
  const restricted = scan.restricted === undefined ? -1 : scan.restricted ? 1 : 0;
  await db.prepare(`UPDATE chats SET telegram_forum=?1,telegram_thread_id=?2,telegram_thread_title=?3,telegram_topics_json=?4,telegram_topics_at=?5,
      telegram_restricted_at=CASE ?8 WHEN 1 THEN COALESCE(telegram_restricted_at,?5) WHEN 0 THEN NULL ELSE telegram_restricted_at END
    WHERE id=?6 AND user_id=?7 AND platform='telegram'`)
    .bind(scan.forum ? 1 : 0, threadId, threadTitle, scan.forum ? JSON.stringify(topics) : null, now, chatId, userId, restricted).run();
  return { threadLost: Boolean(current.thread && !threadId) };
}

/** Власник вибрав гілку (або прибрав вибір). Закриту гілку вибрати не можна. */
export async function chooseTelegramThread(db: D1Database, userId: string, chatId: string, threadId: unknown): Promise<TelegramThreadState> {
  const state = await readTelegramThreadState(db, userId, chatId);
  if (threadId === null || threadId === undefined || threadId === '') {
    await db.prepare(`UPDATE chats SET telegram_thread_id=NULL,telegram_thread_title=NULL WHERE id=?1 AND user_id=?2 AND platform='telegram'`).bind(chatId, userId).run();
    return { ...state, thread: null };
  }
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) throw new TelegramAutopostError('Некоректна гілка.', 400, 'bad_thread');
  if (state.forum !== true) throw new TelegramAutopostError('У цього чату немає гілок. Відкрий чат і дай автопосту зібрати список гілок.', 409, 'not_forum');
  const topic = state.topics.find((item) => item.id === threadId);
  if (!topic) throw new TelegramAutopostError('Такої гілки немає в списку. Дай автопосту зібрати гілки ще раз.', 409, 'thread_unknown');
  if (topic.closed) throw new TelegramAutopostError('Ця гілка закрита, писати в неї не можна.', 409, 'thread_closed');
  const result = await db.prepare(`UPDATE chats SET telegram_thread_id=?1,telegram_thread_title=?2 WHERE id=?3 AND user_id=?4 AND platform='telegram' RETURNING id`)
    .bind(topic.id, topic.title, chatId, userId).all<{ id: string }>();
  if (result.results.length !== 1) throw new TelegramAutopostError('Чат не знайдено.', 404, 'chat_not_found');
  return { ...state, thread: { id: topic.id, title: topic.title } };
}

/** Чати з гілками, для яких гілку ще не вибрано (частковий індекс): група «Вибрати гілку». */
export async function readTelegramThreadChoices(db: D1Database, userId: string, accountId: string | null) {
  if (!accountId) return [];
  const rows = await db.prepare(`SELECT id,name,telegram_topics_json,telegram_restricted_at FROM chats
    WHERE user_id=?1 AND platform='telegram' AND telegram_account_id=?2 AND telegram_forum=1 AND telegram_thread_id IS NULL AND workflow_status='ready'
    ORDER BY name LIMIT 200`).bind(userId, accountId).all<{ id: string; name: string; telegram_topics_json: string | null; telegram_restricted_at: number | null }>();
  return (rows.results || []).map((row) => ({ chatId: row.id, name: row.name, topics: parseTelegramTopics(row.telegram_topics_json), restrictedAt: row.telegram_restricted_at === null ? null : Number(row.telegram_restricted_at) }));
}
export type TelegramThreadChoice = Awaited<ReturnType<typeof readTelegramThreadChoices>>[number];

/** Telegram-акаунт, що публікує: id користувача в Telegram Web (прив'язує оператор) і чи ввімкнений. */
export async function readTelegramAutopostAccount(db: D1Database, userId: string, accountId: string) {
  return db.prepare(`SELECT id,name,web_user_id,is_enabled FROM telegram_accounts WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(accountId, userId).first<{ id: string; name: string; web_user_id: string | null; is_enabled: number }>();
}

/** Оператор прив'язує акаунт Work OS до того, що зараз залогінений у Telegram Web runner. */
export async function bindTelegramWebAccount(db: D1Database, userId: string, accountId: string, webUserId: unknown, now: number) {
  const id = typeof webUserId === 'string' ? webUserId.trim() : '';
  if (!/^[0-9]{3,20}$/.test(id)) throw new TelegramAutopostError('Не вдалося визначити акаунт у браузері. Відкрий Telegram Web і спробуй ще раз.', 400, 'bad_identity');
  const taken = await db.prepare(`SELECT name FROM telegram_accounts WHERE user_id=?1 AND web_user_id=?2 AND id<>?3 LIMIT 1`).bind(userId, id, accountId).first<{ name: string }>();
  if (taken) throw new TelegramAutopostError(`Цей акаунт Telegram уже прив'язано до «${taken.name}».`, 409, 'identity_taken');
  const result = await db.prepare(`UPDATE telegram_accounts SET web_user_id=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 RETURNING id`)
    .bind(id, now, accountId, userId).all<{ id: string }>();
  if (result.results.length !== 1) throw new TelegramAutopostError('Акаунт не знайдено.', 404, 'account_not_found');
  return { webUserId: id };
}

export async function unbindTelegramWebAccount(db: D1Database, userId: string, accountId: string, now: number) {
  await db.prepare(`UPDATE telegram_accounts SET web_user_id=NULL,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now, accountId, userId).run();
}
