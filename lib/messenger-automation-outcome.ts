import { businessDate, businessDayStart, shiftBusinessDate } from './business-time.ts';
import { lessonEpoch } from './leads/domain/time.ts';
import { chatStateEvent, chatStateTokenSql, readChatState } from './chats/state.ts';
import { transitionChat } from './chats/transitions.ts';
import { AUTO_RENAME_THRESHOLD, isSimilarName, nameSimilarity } from './name-similarity.ts';

/** Скільки разів задачу пробують, перш ніж пропустити на сьогодні: перша спроба і ще дві. */
export const MAX_AUTOPOST_ATTEMPTS = 3;

/** `needs_thread` — Telegram: чат із гілками чекає вибору гілки. Це не збій і не рішення про помилку: у «Не вдалося» не рахується. */
export type AutopostOutcome = 'archived' | 'waiting' | 'snoozed' | 'skipped' | 'needs_decision' | 'needs_thread' | 'resolved';
export type AutopostDecision = 'archive' | 'snooze' | 'retry' | 'check' | 'rename';

type Policy =
  | { kind: 'archive'; reason: string }
  | { kind: 'waiting' }
  | { kind: 'postpone' }
  | { kind: 'retry' }
  | { kind: 'skip' }
  | { kind: 'thread' }
  | { kind: 'decision' };

const ARCHIVE_ADMINS = 'Пишуть лише адміни';
const ARCHIVE_BANNED = 'Забанено';
const ARCHIVE_MISSING = 'Чат не існує';
const ARCHIVE_NO_ACCESS = 'Немає доступу';
const ARCHIVE_DECIDED = 'Не вдалося опублікувати';

const ADMIN_ONLY = new Set(['admin_only', 'read_only', 'viber_read_only', 'telegram_read_only']);
const BANNED = new Set(['whatsapp_removed_from_group', 'viber_banned', 'membership_left', 'telegram_banned']);
const MISSING = new Set(['invalid_whatsapp_link', 'invalid_viber_link', 'whatsapp_chat_missing', 'viber_chat_missing', 'telegram_chat_missing']);
const POSTPONE = new Set(['whatsapp_join_retry_later', 'slow_mode', 'rate_limited', 'viber_slow_mode', 'telegram_slow_mode',
  // Telegram: у чаті зараз не можна писати (нічний режим бота, права чату, «лише адміни» на весь чат) — це не закрита гілка і не архів.
  'telegram_chat_restricted']);
// Усе, що точно сталося до натискання «Надіслати»: повтор не може дати дубль.
const RETRY = new Set([
  'page_not_ready', 'whatsapp_messages_loading', 'whatsapp_not_authenticated', 'cdp_unavailable',
  'media_attach_failed', 'media_preview_not_ready', 'media_caption_not_found', 'media_caption_mismatch',
  'autopost_budget_exhausted', 'composer_not_found', 'composer_content_mismatch', 'expected_control_disappeared',
  'membership_not_confirmed', 'joined_target_not_verified', 'media_send_control_not_found',
  'send_ui_unavailable', 'android_error',
  // Telegram Web: усе до натискання «Надіслати» (вкладка не готова, чат чи поле повідомлення не відкрились).
  // Viber: крок завис до «Send» і його обірвав сторож; чат не зачеплено, повтор не дасть дубля.
  'viber_step_timeout', 'viber_task_timeout',
  'telegram_page_not_ready', 'telegram_chat_not_opened', 'telegram_attachment_not_opened', 'telegram_send_not_clicked', 'telegram_composer_not_found', 'telegram_text_mismatch', 'telegram_thread_not_opened',
]);
// Чат змінився до відправки або немає фото для відправки: чіпати нічого, пропускаємо на сьогодні.
const SKIP = new Set(['stale_precondition', 'image_missing']);

/**
 * Що робити з чатом після невдалої автопублікації. Незнайомий код і будь-який збій після натискання «Надіслати»
 * (повідомлення могло піти) — це «потребує рішення»: чат не чіпаємо, власник вирішує сам.
 */
export function classifyAutopostFailure(code: string, platform: string): Policy {
  if (ADMIN_ONLY.has(code)) return { kind: 'archive', reason: ARCHIVE_ADMINS };
  if (BANNED.has(code)) return { kind: 'archive', reason: ARCHIVE_BANNED };
  if (MISSING.has(code)) return { kind: 'archive', reason: ARCHIVE_MISSING };
  // Telegram: акаунт не бачить чат (не учасник, вийшов чи вилучений) — власнику нема що вирішувати, чат іде в архів із причиною.
  if (code === 'telegram_no_access') return { kind: 'archive', reason: ARCHIVE_NO_ACCESS };
  // «Очікування» є лише у WhatsApp і Telegram; у Viber невдалий вступ вирішує власник.
  if (code === 'approval_required' && platform === 'whatsapp') return { kind: 'waiting' };
  if (POSTPONE.has(code)) return { kind: 'postpone' };
  if (THREAD_CODES.has(code)) return { kind: 'thread' };
  if (RETRY.has(code)) return { kind: 'retry' };
  if (SKIP.has(code)) return { kind: 'skip' };
  return { kind: 'decision' };
}

type JobRef = { id: string; chat_id: string; attempts: number; result_json?: string | null };

async function closeJob(db: D1Database, userId: string, jobId: string, outcome: AutopostOutcome, attempts: number, result: Record<string, unknown>, now: number) {
  await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status=CASE WHEN request_key LIKE 'scan\\_%' ESCAPE '\\' THEN 'cancelled' ELSE 'failed' END,active_key=NULL,outcome=?1,attempts=?2,result_json=?3,updated_at=?4,completed_at=?4
    WHERE id=?5 AND user_id=?6 AND status IN ('pending','claimed')`)
    .bind(outcome, attempts, JSON.stringify({ ...result, outcome }), now, jobId, userId).run();
}

/** Початок наступної доби за київським часом: «відкласти на завтра». */
export function tomorrowStart(now: number) {
  return businessDayStart(shiftBusinessDate(businessDate(now), 1));
}

/**
 * Коли чат знову можна пробувати, якщо бот-модератор написав «до 7:00»: найближчий такий час за київським часом, але не пізніше ніж
 * через добу. Без часу (або з хибним) — початок наступної доби.
 */
export function quietResumeAt(now: number, hour: unknown, minute: unknown) {
  const h = Number(hour);
  const m = Number(minute ?? 0);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return tomorrowStart(now);
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const today = businessDate(now);
  let at = lessonEpoch(today, clock);
  if (at !== null && at <= now + 300) at = lessonEpoch(shiftBusinessDate(today, 1), clock);
  return at === null || at - now > 86400 ? tomorrowStart(now) : at;
}

async function snoozeUntil(db: D1Database, userId: string, chatId: string, until: number, now: number) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat || chat.workflow_status !== 'ready') return false;
  const result = await db.batch([
    db.prepare(`UPDATE chats SET snoozed_until=?1,updated_at=?2
      WHERE id=?3 AND user_id=?4 AND workflow_status='ready' AND ${chatStateTokenSql('chats')}=?5`)
      .bind(until, now, chatId, userId, chat.state_token),
    chatStateEvent(db, { id: crypto.randomUUID(), userId, chatId, action: 'snooze', now, previous: chat.state_token }),
  ]);
  return Boolean(result[0].meta.changes);
}

const snoozeUntilTomorrow = (db: D1Database, userId: string, chatId: string, now: number) => snoozeUntil(db, userId, chatId, tomorrowStart(now), now);

async function archiveChat(db: D1Database, userId: string, chatId: string, reason: string, now: number) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat) return false;
  return (await transitionChat(db, { userId, chat, action: 'archive', accountId: null, now, reason })).ok;
}

async function moveToWaiting(db: D1Database, userId: string, chatId: string, now: number) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat || !(await transitionChat(db, { userId, chat, action: 'return_to_join', accountId: null, now })).ok) return false;
  const next = await readChatState(db, userId, chatId);
  return Boolean(next && (await transitionChat(db, { userId, chat: next, action: 'waiting', accountId: null, now })).ok);
}

/**
 * Відправка без підтвердження (повідомлення могло піти) більше не віддається власнику одразу. Та сама задача проходить сама:
 * `verify` (runner відкриває чат і гортає стрічку до моменту відправки: знайшов — «відправлено»), за потреби ще раз `verify2`
 * (не вдалось визначити), а коли повідомлення точно немає, — один `resend` (повторна відправка). Лише після цього — «Потребують рішення».
 * Стан живе в `result_json.follow`; момент відправки — `result_json.verifyFrom`.
 */
export type AutopostFollow = '' | 'verify' | 'verify2' | 'resend';
const UNCONFIRMED = new Set(['send_not_confirmed', 'helper_timeout', 'media_send_not_confirmed']);
function renamedBefore(resultJson: string | null | undefined): boolean {
  try {
    const parsed: unknown = resultJson ? JSON.parse(resultJson) : null;
    return Boolean(parsed && typeof parsed === 'object' && (parsed as { renamed?: unknown }).renamed === true);
  } catch { return false; }
}
export function followOf(resultJson: string | null | undefined): AutopostFollow {
  try {
    const parsed: unknown = resultJson ? JSON.parse(resultJson) : null;
    const value = parsed && typeof parsed === 'object' ? (parsed as { follow?: unknown }).follow : '';
    return value === 'verify' || value === 'verify2' || value === 'resend' ? value : '';
  } catch { return ''; }
}
export function verifyFromOf(resultJson: string | null | undefined): number {
  try {
    const parsed: unknown = resultJson ? JSON.parse(resultJson) : null;
    const value = parsed && typeof parsed === 'object' ? Number((parsed as { verifyFrom?: unknown }).verifyFrom) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

/**
 * Закриває невдалу спробу за політикою власника: архів із причиною, «Очікування», відкласти на завтра, повтор
 * (до MAX_AUTOPOST_ATTEMPTS) або «потребує рішення». Повертає 'retry', коли задача знову стала в чергу.
 */
export async function settleAutopostFailure(
  db: D1Database,
  userId: string,
  job: JobRef,
  input: { errorCode: string; result: Record<string, unknown>; now: number; resume?: { hour: unknown; minute: unknown } | null; /** Коли runner натиснув «Надіслати» (epoch, с): від цього моменту шукається повідомлення. */ sentAt?: number | null },
): Promise<{ outcome: AutopostOutcome | 'retry'; attempts: number }> {
  const { errorCode, now } = input;
  const result = { ...input.result, errorCode };
  const chat = await readChatState(db, userId, job.chat_id);
  const policy = chat ? classifyAutopostFailure(errorCode, chat.platform) : ({ kind: 'skip' } as const);
  const attempts = Number(job.attempts) + 1;
  let outcome: AutopostOutcome | 'retry';
  // «Не той чат» із майже тією самою назвою (емодзі, регістр, «в Viber», «[чат]»): месенджер показав саме цей чат, тож назва в Work OS
  // оновлюється сама, а задача повертається в чергу (один раз). Лише зовсім інша назва йде до власника.
  const observedTitle = cleanChatName(typeof input.result.observedTarget === 'string' ? input.result.observedTarget : '');
  if (errorCode === 'target_unconfirmed' && chat && observedTitle && !renamedBefore(job.result_json)
    && observedTitle !== chat.name && nameSimilarity(chat.name, observedTitle) >= AUTO_RENAME_THRESHOLD && chat.workflow_status === 'ready') {
    const renamed = await db.prepare(`UPDATE chats SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 AND workflow_status='ready' RETURNING id`)
      .bind(observedTitle, now, job.chat_id, userId).all<{ id: string }>();
    const fresh = renamed.results.length === 1 ? await readChatState(db, userId, job.chat_id) : null;
    if (fresh) {
      await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='pending',attempts=?1,expected_name=?2,chat_state_token=?3,result_json=?4,updated_at=?5
        WHERE id=?6 AND user_id=?7 AND status IN ('pending','claimed')`)
        .bind(attempts, observedTitle, fresh.state_token, JSON.stringify({ ...result, renamed: true, renamedFrom: chat.name }), now, job.id, userId).run();
      return { outcome: 'retry', attempts };
    }
  }
  // Автоматичне «перевірити, а потім один раз повторити» для відправки без підтвердження.
  const follow = followOf(job.result_json);
  let nextFollow: AutopostFollow | null = null;
  if (UNCONFIRMED.has(errorCode) && follow === '') nextFollow = 'verify';
  else if (errorCode === 'message_not_found' && (follow === 'verify' || follow === 'verify2')) nextFollow = 'resend';
  else if (errorCode === 'verify_inconclusive' && follow === 'verify') nextFollow = 'verify2';
  if (nextFollow) {
    const sentAt = verifyFromOf(job.result_json) || (Number(input.sentAt) > 0 ? Number(input.sentAt) : now - 60);
    await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='pending',attempts=?1,result_json=?2,updated_at=?3
      WHERE id=?4 AND user_id=?5 AND status IN ('pending','claimed')`)
      .bind(attempts, JSON.stringify({ ...result, follow: nextFollow, verifyFrom: sentAt }), now, job.id, userId).run();
    return { outcome: 'retry', attempts };
  }
  if (policy.kind === 'retry' && attempts < MAX_AUTOPOST_ATTEMPTS) {
    // Назад у чергу, але за всіма, хто ще не пробував: одна «вперта» задача не блокує решту.
    await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='pending',attempts=?1,result_json=?2,updated_at=?3
      WHERE id=?4 AND user_id=?5 AND status IN ('pending','claimed')`)
      .bind(attempts, JSON.stringify(follow ? { ...result, follow, verifyFrom: verifyFromOf(job.result_json) } : result), now, job.id, userId).run();
    return { outcome: 'retry', attempts };
  }
  if (policy.kind === 'archive') outcome = await archiveChat(db, userId, job.chat_id, policy.reason, now) ? 'archived' : 'needs_decision';
  else if (policy.kind === 'waiting') outcome = await moveToWaiting(db, userId, job.chat_id, now) ? 'waiting' : 'needs_decision';
  else if (policy.kind === 'postpone') {
    const until = input.resume ? quietResumeAt(now, input.resume.hour, input.resume.minute) : tomorrowStart(now);
    outcome = await snoozeUntil(db, userId, job.chat_id, until, now) ? 'snoozed' : 'skipped';
  }
  else if (policy.kind === 'thread') outcome = 'needs_thread';
  else if (policy.kind === 'retry' || policy.kind === 'skip') outcome = 'skipped';
  else outcome = 'needs_decision';
  await closeJob(db, userId, job.id, outcome, attempts, result, now);
  return { outcome, attempts };
}

/** Рішення власника зі списку «Потребують рішення». Для «retry» повертає чат, а нову задачу створює викликач. */
export async function resolveAutopostDecision(
  db: D1Database,
  userId: string,
  input: { jobId: string; decision: AutopostDecision; requireSimilar?: boolean; /** Дія лише для задач із цим кодом помилки (масова повторна відправка: тільки «повідомлення не знайдено»). */ requireCode?: string },
  now: number,
): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const job = await db.prepare(`SELECT id,chat_id,outcome,result_json FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(input.jobId, userId).first<{ id: string; chat_id: string; outcome: string | null; result_json: string | null }>();
  if (!job || (job.outcome !== 'needs_decision' && job.outcome !== 'needs_thread')) return { ok: false, error: 'Це рішення вже прийнято. Оновіть список.' };
  if (input.requireCode && errorCodeOf(job.result_json) !== input.requireCode) return { ok: false, error: 'Для масової дії потрібна перевірена відсутність повідомлення.' };
  if (input.decision === 'archive') {
    if (!await archiveChat(db, userId, job.chat_id, ARCHIVE_DECIDED, now)) return { ok: false, error: 'Стан чату вже змінився. Оновіть список.' };
  } else if (input.decision === 'snooze') {
    if (!await snoozeUntilTomorrow(db, userId, job.chat_id, now)) return { ok: false, error: 'Чат уже не в черзі публікації. Оновіть список.' };
  } else if (input.decision === 'rename') {
    // «Це той самий чат»: назва в Work OS стає такою, як її показує месенджер; нову задачу створює викликач.
    const observed = cleanChatName(observedName(job.result_json));
    if (!observed) return { ok: false, error: 'Месенджер не повернув назву чату. Оновіть назву вручну.' };
    const chat = await readChatState(db, userId, job.chat_id);
    if (!chat || chat.workflow_status !== 'ready') return { ok: false, error: 'Чат уже не в черзі публікації. Оновіть список.' };
    if (input.requireSimilar && !isSimilarName(chat.name, observed)) return { ok: false, error: 'Назви надто різні для масової дії.' };
    const renamed = await db.prepare(`UPDATE chats SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 RETURNING id`).bind(observed, now, job.chat_id, userId).all<{ id: string }>();
    if (renamed.results.length !== 1) return { ok: false, error: 'Не вдалося оновити назву чату.' };
  }
  const updated = await db.prepare(`UPDATE whatsapp_autopost_jobs SET outcome='resolved',updated_at=?1 WHERE id=?2 AND user_id=?3 AND outcome IN ('needs_decision','needs_thread') RETURNING id`)
    .bind(now, job.id, userId).all<{ id: string }>();
  if (updated.results.length !== 1) return { ok: false, error: 'Це рішення вже прийнято. Оновіть список.' };
  return { ok: true, chatId: job.chat_id };
}

function errorCodeOf(resultJson: string | null): string {
  try {
    const parsed: unknown = resultJson ? JSON.parse(resultJson) : null;
    const value = parsed && typeof parsed === 'object' ? (parsed as { errorCode?: unknown }).errorCode : '';
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

function observedName(resultJson: string | null): string {
  try {
    const parsed: unknown = resultJson ? JSON.parse(resultJson) : null;
    const value = parsed && typeof parsed === 'object' ? (parsed as { observedTarget?: unknown }).observedTarget : '';
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

/** Гілка потрібна: ці чати показуються окремою групою «Вибрати гілку», а не в «Потребують рішення». */
const THREAD_CODES = new Set(['thread_required', 'thread_closed']);

const cleanChatName = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);

/** Те саме рішення для кількох чатів (група в «Потребують рішення»). Повертає тих, кого вдалося закрити, і скільки пропущено. */
export async function resolveAutopostDecisions(
  db: D1Database,
  userId: string,
  input: { jobIds: string[]; decision: AutopostDecision; requireSimilar?: boolean; requireCode?: string },
  now: number,
): Promise<{ resolved: Array<{ jobId: string; chatId: string }>; skipped: number }> {
  const resolved: Array<{ jobId: string; chatId: string }> = [];
  let skipped = 0;
  for (const jobId of input.jobIds.slice(0, 100)) {
    const result = await resolveAutopostDecision(db, userId, { jobId, decision: input.decision, requireSimilar: input.requireSimilar, requireCode: input.requireCode }, now);
    if (result.ok) resolved.push({ jobId, chatId: result.chatId });
    else skipped += 1;
  }
  return { resolved, skipped };
}

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number; /** Назва чату, яку бачив месенджер (для «Не той чат»). */ observed: string | null };

/**
 * Чати платформи, які автопост не чіпав і чекає рішення власника, лише з партій сьогодні. З новим днем учорашні зникають зі
 * списку самі: чат не архівується й не змінюється, лишається в «Для публікації», а та сама помилка завтра з'явиться знову.
 */
export async function readAutopostAttention(db: D1Database, userId: string, platform: 'whatsapp' | 'viber' | 'telegram', date: string): Promise<AutopostAttentionItem[]> {
  const rows = await db.prepare(`SELECT j.id AS id,j.chat_id AS chat_id,j.expected_name AS name,j.result_json AS result_json,j.updated_at AS updated_at
    FROM whatsapp_autopost_jobs j JOIN chats c ON c.id=j.chat_id AND c.user_id=j.user_id
    WHERE j.user_id=?1 AND j.outcome='needs_decision' AND c.platform=?2 AND j.published_on=?3
    ORDER BY j.updated_at DESC,j.id LIMIT 100`).bind(userId, platform, date)
    .all<{ id: string; chat_id: string; name: string; result_json: string | null; updated_at: number }>();
  return (rows.results || []).filter((row) => !(platform === 'telegram' && THREAD_CODES.has(errorCodeOf(row.result_json)))).map((row) => {
    let code = 'adapter_failed';
    try {
      const parsed: unknown = row.result_json ? JSON.parse(row.result_json) : null;
      if (parsed && typeof parsed === 'object' && typeof (parsed as { errorCode?: unknown }).errorCode === 'string') code = (parsed as { errorCode: string }).errorCode;
    } catch { /* лишається код за замовчуванням */ }
    return { jobId: row.id, chatId: row.chat_id, name: row.name, errorCode: code, updatedAt: Number(row.updated_at), observed: observedName(row.result_json).trim() || null };
  });
}
