import { changeChatSnooze } from './snooze.ts';
import { chatLeftAtSql, chatStateTokenSql, readChatState } from './state.ts';
import { transitionChat } from './transitions.ts';
import { waitingCheckReasonLabel } from './whatsapp-waiting-check-copy.ts';

// Prototype-parity WhatsApp Waiting check. The operator starts one batch; the local runner
// checks the snapshot one chat at a time and the server applies only factual outcomes:
// joined → approved, pending/requested → +3 days, anything else → reported problem.
// Batch state lives in user_settings, so the check needs no Discovery candidate rows and
// never drags manual chats into the Discovery qualification/leave pipeline.
const SETTING_KEY = 'whatsapp_waiting_check_v1';
const MAX_BATCH = 500;
const LEASE_SECONDS = 120;
const MAX_PROBLEMS = 30;
const MAX_CONSECUTIVE_FAILURES = 3;
export const WAITING_CHECK_FATAL_REASONS = new Set([
  'stale_overlay_not_dismissed', 'navigation_unconfirmed', 'action_unconfirmed', 'join_action_unconfirmed',
  'request_state_unconfirmed', 'expected_control_disappeared',
]);

// Factual answers WhatsApp gives about one particular chat. They are reported as problems but do not
// count towards the "failures in a row" stop: the same few chats can answer this on every run.
export const WAITING_CHECK_CHAT_REASONS = new Set([
  'whatsapp_join_retry_later', 'whatsapp_removed_from_group', 'invalid_whatsapp_link', 'whatsapp_chat_missing', 'membership_left',
]);

export type WaitingCheckOutcome = 'joined' | 'pending' | 'requested' | 'failed';

type Counts = { joined: number; pending: number; requested: number; failed: number; skipped: number };
type Problem = { chatId: string; name: string; reason: string };
// What the operator needs to decide a problem from the panel (open, accept, +3 days, archive).
export type WaitingCheckProblemChat = { link: string; stateToken: string };
type BatchState = {
  batchId: number;
  startedAt: number;
  total: number;
  queue: string[];
  current: { chatId: string; deviceId: string; leaseExpiresAt: number } | null;
  counts: Counts;
  consecutiveFailed: number;
  problems: Problem[];
  stopReason: string | null;
  finishedAt: number | null;
  lastActivityAt: number | null;
};

export type WaitingCheckStatus = {
  active: boolean;
  batchId: number | null;
  total: number;
  remaining: number;
  counts: Counts;
  problems: Array<Problem & { chat?: WaitingCheckProblemChat }>;
  stopReason: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastActivityAt: number | null;
  currentName: string | null;
  runnerSeenAt: number | null;
};

// Problems of a finished batch that still wait for an operator decision. A chat the operator already
// moved, snoozed or archived drops out of the list. Primary-key lookups only, at most MAX_PROBLEMS rows.
async function openProblems(db: D1Database, userId: string, problems: Problem[], now: number) {
  if (!problems.length) return [];
  const rows = await db.prepare(`SELECT c.id,c.link,${chatStateTokenSql('c')} AS state_token
    FROM json_each(?2) j CROSS JOIN chats c ON c.id=j.value AND c.user_id=?1
    WHERE c.platform='whatsapp' AND c.workflow_status='waiting' AND (c.snoozed_until IS NULL OR c.snoozed_until<=?3)`)
    .bind(userId, JSON.stringify(problems.map(problem => problem.chatId)), now)
    .all<{ id: string; link: string; state_token: string }>();
  const byId = new Map(rows.results.map(row => [row.id, row]));
  return problems.flatMap(problem => {
    const row = byId.get(problem.chatId);
    return row ? [{ ...problem, chat: { link: row.link, stateToken: row.state_token } }] : [];
  });
}

export type WaitingCheckTask = {
  kind: 'whatsapp_waiting_check';
  batchId: number;
  chatId: string;
  name: string;
  link: string;
  leaseExpiresAt: number;
};

export class WaitingCheckError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

const emptyCounts = (): Counts => ({ joined: 0, pending: 0, requested: 0, failed: 0, skipped: 0 });

async function readState(db: D1Database, userId: string): Promise<{ state: BatchState | null; raw: string | null }> {
  const row = await db.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
    .bind(userId, SETTING_KEY).first<{ value_json: string }>();
  if (!row) return { state: null, raw: null };
  try {
    const parsed = JSON.parse(row.value_json) as BatchState;
    if (!parsed || !Array.isArray(parsed.queue) || !Number.isSafeInteger(parsed.batchId)) return { state: null, raw: row.value_json };
    return { state: { ...parsed, counts: { ...emptyCounts(), ...parsed.counts }, problems: parsed.problems || [] }, raw: row.value_json };
  } catch {
    return { state: null, raw: row.value_json };
  }
}

// Compare-and-swap on the stored JSON so two concurrent callbacks cannot lose an update.
async function writeState(db: D1Database, userId: string, previousRaw: string | null, next: BatchState, now: number) {
  const value = JSON.stringify(next);
  const result = previousRaw === null
    ? await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,source_import_id,updated_at)
        VALUES (?1,?2,?3,NULL,?4) ON CONFLICT(user_id,setting_key) DO NOTHING`)
      .bind(userId, SETTING_KEY, value, now).run()
    : await db.prepare(`UPDATE user_settings SET value_json=?1,updated_at=?2
        WHERE user_id=?3 AND setting_key=?4 AND value_json=?5`)
      .bind(value, now, userId, SETTING_KEY, previousRaw).run();
  if (!result.meta.changes) throw new WaitingCheckError('Стан перевірки змінився паралельно. Спробуйте ще раз.');
}

function isActive(state: BatchState | null): state is BatchState {
  return Boolean(state && state.finishedAt === null && (state.queue.length > 0 || state.current !== null));
}

function finishIfDrained(state: BatchState, now: number) {
  if (state.finishedAt === null && state.queue.length === 0 && state.current === null) state.finishedAt = now;
}

// onlyProblems re-checks just the chats the previous batch reported as problems; the ids come from
// the stored batch, never from the client.
export async function startWaitingWhatsAppCheck(db: D1Database, userId: string, now: number, { onlyProblems = false } = {}) {
  const { state, raw } = await readState(db, userId);
  const problemIds = new Set((state?.problems ?? []).map(problem => problem.chatId));
  if (isActive(state)) return readWaitingWhatsAppCheckStatus(db, userId);
  const rows = await db.prepare(`SELECT c.id FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='waiting'
      AND ${chatLeftAtSql('c')} IS NULL
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?2)
    ORDER BY COALESCE(c.processed_at,c.updated_at) ASC,c.id LIMIT ${MAX_BATCH}`)
    .bind(userId, now).all<{ id: string }>();
  const queue = rows.results.map(row => row.id).filter(id => !onlyProblems || problemIds.has(id));
  const next: BatchState = {
    batchId: Math.max(1, Math.floor(now)), startedAt: now, total: queue.length, queue, current: null,
    counts: emptyCounts(), consecutiveFailed: 0, problems: [], stopReason: null,
    finishedAt: queue.length ? null : now, lastActivityAt: null,
  };
  await writeState(db, userId, raw, next, now);
  return readWaitingWhatsAppCheckStatus(db, userId);
}

export async function stopWaitingWhatsAppCheck(db: D1Database, userId: string, now: number) {
  const { state, raw } = await readState(db, userId);
  if (!isActive(state)) return readWaitingWhatsAppCheckStatus(db, userId);
  state.queue = [];
  state.current = null;
  state.stopReason = 'зупинено вручну';
  state.finishedAt = now;
  await writeState(db, userId, raw, state, now);
  return readWaitingWhatsAppCheckStatus(db, userId);
}

export async function readWaitingWhatsAppCheckStatus(db: D1Database, userId: string, now = Math.floor(Date.now() / 1000)): Promise<WaitingCheckStatus> {
  const [{ state }, runner] = await Promise.all([
    readState(db, userId),
    db.prepare(`SELECT MAX(last_seen_at) AS seen FROM chat_discovery_executor_devices WHERE user_id=?1 AND revoked_at IS NULL`)
      .bind(userId).first<{ seen: number | null }>(),
  ]);
  let currentName: string | null = null;
  if (state?.current) currentName = (await readChatState(db, userId, state.current.chatId))?.name ?? null;
  const active: boolean = isActive(state);
  const storedProblems: Problem[] = state?.problems ?? [];
  const problems = active ? storedProblems : await openProblems(db, userId, storedProblems, now);
  return {
    active,
    batchId: state?.batchId ?? null,
    total: state?.total ?? 0,
    remaining: state ? state.queue.length + (state.current ? 1 : 0) : 0,
    counts: state?.counts ?? emptyCounts(),
    problems: problems,
    stopReason: state?.stopReason ?? null,
    startedAt: state?.startedAt ?? null,
    finishedAt: state?.finishedAt ?? null,
    lastActivityAt: state?.lastActivityAt ?? null,
    currentName,
    runnerSeenAt: runner?.seen ?? null,
  };
}

function eligible(chat: Awaited<ReturnType<typeof readChatState>>, now: number) {
  return Boolean(chat && chat.platform === 'whatsapp' && chat.workflow_status === 'waiting' && chat.left_at === null
    && (chat.snoozed_until === null || chat.snoozed_until <= now));
}

export async function claimWaitingWhatsAppCheck(db: D1Database, userId: string, deviceId: string, now: number): Promise<WaitingCheckTask | null> {
  const { state, raw } = await readState(db, userId);
  if (!isActive(state)) return null;
  if (state.current && state.current.deviceId !== deviceId && state.current.leaseExpiresAt > now) return null;
  // An expired or same-device lease is re-issued for the same chat instead of being lost.
  const candidates = state.current ? [state.current.chatId, ...state.queue] : [...state.queue];
  state.current = null;
  let task: WaitingCheckTask | null = null;
  while (candidates.length) {
    const chatId = candidates.shift() as string;
    const chat = await readChatState(db, userId, chatId);
    if (!chat || !eligible(chat, now)) { state.counts.skipped += 1; continue; }
    const leaseExpiresAt = now + LEASE_SECONDS;
    state.current = { chatId, deviceId, leaseExpiresAt };
    task = { kind: 'whatsapp_waiting_check', batchId: state.batchId, chatId, name: chat.name, link: chat.link, leaseExpiresAt };
    break;
  }
  state.queue = candidates;
  state.lastActivityAt = now;
  finishIfDrained(state, now);
  await writeState(db, userId, raw, state, now);
  return task;
}

// Runtime problems (WhatsApp Web not logged in, CDP down, global loading) say nothing about the
// chat itself: put it back at the front of the queue without counting a failure.
export async function releaseWaitingWhatsAppCheck(db: D1Database, userId: string, deviceId: string, input: { batchId: number; chatId: string }, now: number) {
  const { state, raw } = await readState(db, userId);
  if (!isActive(state) || state.batchId !== input.batchId || state.current?.chatId !== input.chatId || state.current.deviceId !== deviceId) {
    return { ok: false };
  }
  state.queue = [input.chatId, ...state.queue];
  state.current = null;
  await writeState(db, userId, raw, state, now);
  return { ok: true };
}

export async function completeWaitingWhatsAppCheck(db: D1Database, userId: string, deviceId: string, input: {
  batchId: number; chatId: string; status: WaitingCheckOutcome; reason?: string; observedName?: string;
}, now: number) {
  const { state, raw } = await readState(db, userId);
  if (!state || state.batchId !== input.batchId || state.current?.chatId !== input.chatId || state.current.deviceId !== deviceId) {
    throw new WaitingCheckError('Ця перевірка вже не належить цьому пристрою. Оновіть чергу.');
  }
  const chat = await readChatState(db, userId, input.chatId);
  let applied: WaitingCheckOutcome | 'skipped' = input.status;
  let reason = String(input.reason || '').slice(0, 100);
  if (!chat || !eligible(chat, now)) {
    // The operator changed the chat while it was being checked; their action wins.
    applied = 'skipped';
  } else if (input.status === 'joined') {
    const moved = await transitionChat(db, { userId, chat, action: 'approved', accountId: null, now });
    if (!moved.ok) applied = 'skipped';
  } else if (input.status === 'pending' || input.status === 'requested') {
    const snoozed = await changeChatSnooze(db, {
      userId, id: chat.id, status: chat.workflow_status, previousDeadline: chat.snoozed_until,
      now, resume: false, stateToken: chat.state_token,
    });
    if (!snoozed) applied = 'skipped';
  } else {
    reason = reason || 'unknown';
  }

  state.current = null;
  state.lastActivityAt = now;
  state.counts[applied] += 1;
  if (applied === 'failed') {
    if (!WAITING_CHECK_CHAT_REASONS.has(reason)) state.consecutiveFailed += 1;
    state.problems = [...state.problems, { chatId: input.chatId, name: chat?.name || input.observedName || input.chatId, reason }]
      .slice(-MAX_PROBLEMS);
    if (WAITING_CHECK_FATAL_REASONS.has(reason) || state.consecutiveFailed >= MAX_CONSECUTIVE_FAILURES) {
      state.stopReason = WAITING_CHECK_FATAL_REASONS.has(reason)
        ? `${chat?.name || input.chatId}: ${waitingCheckReasonLabel(reason)}`
        : `${MAX_CONSECUTIVE_FAILURES} помилки поспіль`;
      state.queue = [];
      state.finishedAt = now;
    }
  } else if (applied !== 'skipped') {
    state.consecutiveFailed = 0;
  }
  finishIfDrained(state, now);
  await writeState(db, userId, raw, state, now);
  return { ok: true, applied };
}
