import { businessDate, businessDayStart, shiftBusinessDate } from './business-time.ts';
import { chatStateEvent, chatStateTokenSql, readChatState } from './chats/state.ts';
import { transitionChat } from './chats/transitions.ts';

/** Скільки разів задачу пробують, перш ніж пропустити на сьогодні: перша спроба і ще дві. */
export const MAX_AUTOPOST_ATTEMPTS = 3;

export type AutopostOutcome = 'archived' | 'waiting' | 'snoozed' | 'skipped' | 'needs_decision' | 'resolved';
export type AutopostDecision = 'archive' | 'snooze' | 'retry';

type Policy =
  | { kind: 'archive'; reason: string }
  | { kind: 'waiting' }
  | { kind: 'postpone' }
  | { kind: 'retry' }
  | { kind: 'skip' }
  | { kind: 'decision' };

const ARCHIVE_ADMINS = 'Пишуть лише адміни';
const ARCHIVE_BANNED = 'Забанено';
const ARCHIVE_MISSING = 'Чат не існує';
const ARCHIVE_DECIDED = 'Не вдалося опублікувати';

const ADMIN_ONLY = new Set(['admin_only', 'read_only', 'viber_read_only']);
const BANNED = new Set(['whatsapp_removed_from_group', 'viber_banned', 'membership_left']);
const MISSING = new Set(['invalid_whatsapp_link', 'invalid_viber_link', 'whatsapp_chat_missing', 'viber_chat_missing']);
const POSTPONE = new Set(['whatsapp_join_retry_later', 'slow_mode', 'rate_limited', 'viber_slow_mode']);
// Усе, що точно сталося до натискання «Надіслати»: повтор не може дати дубль.
const RETRY = new Set([
  'page_not_ready', 'whatsapp_messages_loading', 'whatsapp_not_authenticated', 'cdp_unavailable',
  'media_attach_failed', 'media_preview_not_ready', 'media_caption_not_found', 'media_caption_mismatch',
  'autopost_budget_exhausted', 'composer_not_found', 'composer_content_mismatch', 'expected_control_disappeared',
  'membership_not_confirmed', 'joined_target_not_verified', 'media_send_control_not_found',
  'send_ui_unavailable', 'android_error',
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
  // «Очікування» є лише у WhatsApp і Telegram; у Viber невдалий вступ вирішує власник.
  if (code === 'approval_required' && platform === 'whatsapp') return { kind: 'waiting' };
  if (POSTPONE.has(code)) return { kind: 'postpone' };
  if (RETRY.has(code)) return { kind: 'retry' };
  if (SKIP.has(code)) return { kind: 'skip' };
  return { kind: 'decision' };
}

type JobRef = { id: string; chat_id: string; attempts: number };

async function closeJob(db: D1Database, userId: string, jobId: string, outcome: AutopostOutcome, attempts: number, result: Record<string, unknown>, now: number) {
  await db.prepare(`UPDATE whatsapp_autopost_jobs
    SET status='failed',active_key=NULL,outcome=?1,attempts=?2,result_json=?3,updated_at=?4,completed_at=?4
    WHERE id=?5 AND user_id=?6 AND status IN ('pending','claimed')`)
    .bind(outcome, attempts, JSON.stringify({ ...result, outcome }), now, jobId, userId).run();
}

/** Початок наступної доби за київським часом: «відкласти на завтра». */
export function tomorrowStart(now: number) {
  return businessDayStart(shiftBusinessDate(businessDate(now), 1));
}

async function snoozeUntilTomorrow(db: D1Database, userId: string, chatId: string, now: number) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat || chat.workflow_status !== 'ready') return false;
  const result = await db.batch([
    db.prepare(`UPDATE chats SET snoozed_until=?1,updated_at=?2
      WHERE id=?3 AND user_id=?4 AND workflow_status='ready' AND ${chatStateTokenSql('chats')}=?5`)
      .bind(tomorrowStart(now), now, chatId, userId, chat.state_token),
    chatStateEvent(db, { id: crypto.randomUUID(), userId, chatId, action: 'snooze', now, previous: chat.state_token }),
  ]);
  return Boolean(result[0].meta.changes);
}

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
 * Закриває невдалу спробу за політикою власника: архів із причиною, «Очікування», відкласти на завтра, повтор
 * (до MAX_AUTOPOST_ATTEMPTS) або «потребує рішення». Повертає 'retry', коли задача знову стала в чергу.
 */
export async function settleAutopostFailure(
  db: D1Database,
  userId: string,
  job: JobRef,
  input: { errorCode: string; result: Record<string, unknown>; now: number },
): Promise<{ outcome: AutopostOutcome | 'retry'; attempts: number }> {
  const { errorCode, now } = input;
  const result = { ...input.result, errorCode };
  const chat = await readChatState(db, userId, job.chat_id);
  const policy = chat ? classifyAutopostFailure(errorCode, chat.platform) : ({ kind: 'skip' } as const);
  const attempts = Number(job.attempts) + 1;
  let outcome: AutopostOutcome | 'retry';
  if (policy.kind === 'retry' && attempts < MAX_AUTOPOST_ATTEMPTS) {
    // Назад у чергу, але за всіма, хто ще не пробував: одна «вперта» задача не блокує решту.
    await db.prepare(`UPDATE whatsapp_autopost_jobs SET status='pending',attempts=?1,result_json=?2,updated_at=?3
      WHERE id=?4 AND user_id=?5 AND status IN ('pending','claimed')`)
      .bind(attempts, JSON.stringify(result), now, job.id, userId).run();
    return { outcome: 'retry', attempts };
  }
  if (policy.kind === 'archive') outcome = await archiveChat(db, userId, job.chat_id, policy.reason, now) ? 'archived' : 'needs_decision';
  else if (policy.kind === 'waiting') outcome = await moveToWaiting(db, userId, job.chat_id, now) ? 'waiting' : 'needs_decision';
  else if (policy.kind === 'postpone') outcome = await snoozeUntilTomorrow(db, userId, job.chat_id, now) ? 'snoozed' : 'skipped';
  else if (policy.kind === 'retry' || policy.kind === 'skip') outcome = 'skipped';
  else outcome = 'needs_decision';
  await closeJob(db, userId, job.id, outcome, attempts, result, now);
  return { outcome, attempts };
}

/** Рішення власника зі списку «Потребують рішення». Для «retry» повертає чат, а нову задачу створює викликач. */
export async function resolveAutopostDecision(
  db: D1Database,
  userId: string,
  input: { jobId: string; decision: AutopostDecision },
  now: number,
): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
  const job = await db.prepare(`SELECT id,chat_id,outcome FROM whatsapp_autopost_jobs WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(input.jobId, userId).first<{ id: string; chat_id: string; outcome: string | null }>();
  if (!job || job.outcome !== 'needs_decision') return { ok: false, error: 'Це рішення вже прийнято. Оновіть список.' };
  if (input.decision === 'archive') {
    if (!await archiveChat(db, userId, job.chat_id, ARCHIVE_DECIDED, now)) return { ok: false, error: 'Стан чату вже змінився. Оновіть список.' };
  } else if (input.decision === 'snooze') {
    if (!await snoozeUntilTomorrow(db, userId, job.chat_id, now)) return { ok: false, error: 'Чат уже не в черзі публікації. Оновіть список.' };
  }
  const updated = await db.prepare(`UPDATE whatsapp_autopost_jobs SET outcome='resolved',updated_at=?1 WHERE id=?2 AND user_id=?3 AND outcome='needs_decision' RETURNING id`)
    .bind(now, job.id, userId).all<{ id: string }>();
  if (updated.results.length !== 1) return { ok: false, error: 'Це рішення вже прийнято. Оновіть список.' };
  return { ok: true, chatId: job.chat_id };
}

export type AutopostAttentionItem = { jobId: string; chatId: string; name: string; errorCode: string; updatedAt: number };

/** Чати платформи, які автопост не чіпав і чекає рішення власника (за будь-який день). */
export async function readAutopostAttention(db: D1Database, userId: string, platform: 'whatsapp' | 'viber'): Promise<AutopostAttentionItem[]> {
  const rows = await db.prepare(`SELECT j.id AS id,j.chat_id AS chat_id,j.expected_name AS name,j.result_json AS result_json,j.updated_at AS updated_at
    FROM whatsapp_autopost_jobs j JOIN chats c ON c.id=j.chat_id AND c.user_id=j.user_id
    WHERE j.user_id=?1 AND j.outcome='needs_decision' AND c.platform=?2
    ORDER BY j.updated_at DESC,j.id LIMIT 50`).bind(userId, platform)
    .all<{ id: string; chat_id: string; name: string; result_json: string | null; updated_at: number }>();
  return (rows.results || []).map((row) => {
    let code = 'adapter_failed';
    try {
      const parsed: unknown = row.result_json ? JSON.parse(row.result_json) : null;
      if (parsed && typeof parsed === 'object' && typeof (parsed as { errorCode?: unknown }).errorCode === 'string') code = (parsed as { errorCode: string }).errorCode;
    } catch { /* лишається код за замовчуванням */ }
    return { jobId: row.id, chatId: row.chat_id, name: row.name, errorCode: code, updatedAt: Number(row.updated_at) };
  });
}
