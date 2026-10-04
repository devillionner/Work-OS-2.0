import { changeChatSnooze } from './snooze.ts';
import { chatLeftAtSql, chatStateTokenSql, readChatState } from './state.ts';
import { transitionChat } from './transitions.ts';
import { waitingCheckReasonLabel } from './whatsapp-waiting-check-copy.ts';

// Prototype-parity WhatsApp Waiting check. Batch/process state (queue snapshot, current task,
// counts, problems) lives in the owner's Durable Object storage (workers/owner-channel.js), not
// D1 — these are pure/D1-light building blocks the DO calls directly (bundled into the deployed
// Worker at build time, see scripts/normalize-wrangler-config.mjs). D1 keeps only the facts: the
// eligible-chat snapshot read once at batch start, and the actual workflow transition/snooze a
// completed check applies. There is no device/lease concept any more — the DO's WebSocket
// connection to the runner *is* the ownership proof, so nothing can go stale and need fencing.
const MAX_BATCH = 500;
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
type QueueItem = { id: string; name: string; link: string };
type Problem = { chatId: string; name: string; reason: string };
// What the operator needs to decide a problem from the panel (open, accept, +3 days, archive).
export type WaitingCheckProblemChat = { link: string; stateToken: string };

export type WaitingCheckBatchState = {
  batchId: number;
  startedAt: number;
  total: number;
  queue: QueueItem[];
  current: QueueItem | null;
  counts: Counts;
  consecutiveFailed: number;
  problems: Problem[];
  stopReason: string | null;
  finishedAt: number | null;
  lastActivityAt: number | null;
};

export type WaitingCheckTask = {
  kind: 'whatsapp_waiting_check';
  batchId: number;
  chatId: string;
  name: string;
  link: string;
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
};

const emptyCounts = (): Counts => ({ joined: 0, pending: 0, requested: 0, failed: 0, skipped: 0 });

export function isWaitingCheckBatchActive(batch: WaitingCheckBatchState | null | undefined): batch is WaitingCheckBatchState {
  return Boolean(batch && batch.finishedAt === null && (batch.queue.length > 0 || batch.current !== null));
}

function finishIfDrained(batch: WaitingCheckBatchState, now: number) {
  if (batch.finishedAt === null && batch.queue.length === 0 && batch.current === null) batch.finishedAt = now;
}

function eligible(chat: Awaited<ReturnType<typeof readChatState>>, now: number) {
  return Boolean(chat && chat.platform === 'whatsapp' && chat.workflow_status === 'waiting' && chat.left_at === null
    && (chat.snoozed_until === null || chat.snoozed_until <= now));
}

// The snapshot read at batch start: a fixed list, not re-queried while the batch runs. Re-running
// this WHERE clause mid-batch would keep handing out a chat the batch just reported as a problem
// (nothing in D1 changed for it), so the operator "перевірити проблемні" action re-checks it from
// a separate owner-supplied id list instead — see createWaitingCheckBatch's onlyIds.
export async function readEligibleWaitingChats(db: D1Database, userId: string, now: number): Promise<QueueItem[]> {
  const rows = await db.prepare(`SELECT c.id,c.name,c.link FROM chats c
    WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='waiting'
      AND ${chatLeftAtSql('c')} IS NULL
      AND (c.snoozed_until IS NULL OR c.snoozed_until<=?2)
    ORDER BY COALESCE(c.processed_at,c.updated_at) ASC,c.id LIMIT ${MAX_BATCH}`)
    .bind(userId, now).all<QueueItem>();
  return rows.results;
}

export function createWaitingCheckBatch(items: QueueItem[], now: number, onlyIds?: Set<string>): WaitingCheckBatchState {
  const queue = onlyIds ? items.filter(item => onlyIds.has(item.id)) : items;
  return {
    batchId: Math.max(1, Math.floor(now)), startedAt: now, total: queue.length, queue, current: null,
    counts: emptyCounts(), consecutiveFailed: 0, problems: [], stopReason: null,
    finishedAt: queue.length ? null : now, lastActivityAt: null,
  };
}

export function stopWaitingCheckBatch(batch: WaitingCheckBatchState | null, now: number): WaitingCheckBatchState | null {
  if (!isWaitingCheckBatchActive(batch)) return batch ?? null;
  return { ...batch, queue: [], current: null, stopReason: 'зупинено вручну', finishedAt: now };
}

function taskFromCurrent(batch: WaitingCheckBatchState): WaitingCheckTask | null {
  return batch.current && { kind: 'whatsapp_waiting_check', batchId: batch.batchId, chatId: batch.current.id, name: batch.current.name, link: batch.current.link };
}

// Pops the next chat into `current` and returns the task to send the runner. Called both after a
// batch starts/a result is applied (advance) and when a runner reconnects mid-batch (resume: a
// `current` already set is returned as-is instead of being skipped, since the DO never learned
// whether the runner's in-flight check from before the disconnect actually completed).
export function advanceWaitingCheckTask(batch: WaitingCheckBatchState, now: number): { batch: WaitingCheckBatchState; task: WaitingCheckTask | null } {
  if (!isWaitingCheckBatchActive(batch)) return { batch, task: null };
  if (batch.current) return { batch, task: taskFromCurrent(batch) };
  const queue = [...batch.queue];
  const item = queue.shift();
  if (!item) {
    const finished = { ...batch, queue, finishedAt: batch.finishedAt ?? now };
    return { batch: finished, task: null };
  }
  const next = { ...batch, queue, current: item, lastActivityAt: now };
  return { batch: next, task: taskFromCurrent(next) };
}

// A runtime problem (WhatsApp Web not logged in, CDP down, global loading) says nothing about the
// chat itself: put it back at the front of the queue without counting a failure and without
// immediately redispatching it — the runner asks again (a fresh `ready`) once it has actually
// recovered, so a persistent global problem cannot turn into a tight dispatch loop.
export function releaseWaitingCheckTask(batch: WaitingCheckBatchState | null, input: { batchId: number; chatId: string }, now: number): WaitingCheckBatchState | null {
  if (!isWaitingCheckBatchActive(batch) || batch.batchId !== input.batchId || batch.current?.id !== input.chatId) return null;
  return { ...batch, queue: [batch.current, ...batch.queue], current: null, lastActivityAt: now };
}

// The factual transition a completed check applies. Mirrors the batch's `current` against the
// result so a stale/duplicate message (e.g. after a stop already cleared `current`) is ignored by
// the caller instead of mutating a chat the operator no longer expects this batch to touch.
export async function applyWaitingCheckResult(
  db: D1Database, userId: string, batch: WaitingCheckBatchState,
  input: { batchId: number; chatId: string; status: WaitingCheckOutcome; reason?: string; observedName?: string },
  now: number,
): Promise<{ batch: WaitingCheckBatchState; applied: WaitingCheckOutcome | 'skipped' } | null> {
  if (batch.batchId !== input.batchId || batch.current?.id !== input.chatId) return null;
  const next: WaitingCheckBatchState = { ...batch, counts: { ...batch.counts }, problems: [...batch.problems] };
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

  next.current = null;
  next.lastActivityAt = now;
  next.counts[applied] += 1;
  if (applied === 'failed') {
    if (!WAITING_CHECK_CHAT_REASONS.has(reason)) next.consecutiveFailed += 1;
    next.problems = [...next.problems, { chatId: input.chatId, name: chat?.name || input.observedName || input.chatId, reason }].slice(-MAX_PROBLEMS);
    if (WAITING_CHECK_FATAL_REASONS.has(reason) || next.consecutiveFailed >= MAX_CONSECUTIVE_FAILURES) {
      next.stopReason = WAITING_CHECK_FATAL_REASONS.has(reason)
        ? `${chat?.name || input.chatId}: ${waitingCheckReasonLabel(reason)}`
        : `${MAX_CONSECUTIVE_FAILURES} помилки поспіль`;
      next.queue = [];
      next.finishedAt = now;
    }
  } else if (applied !== 'skipped') {
    next.consecutiveFailed = 0;
  }
  finishIfDrained(next, now);
  return { batch: next, applied };
}

// Pure view of a batch, minus the parts that need a D1 round trip (problems are enriched
// separately, only once the batch is no longer active — see enrichWaitingCheckProblems).
export function waitingCheckStatusFromBatch(batch: WaitingCheckBatchState | null | undefined): Omit<WaitingCheckStatus, 'problems'> {
  const active = isWaitingCheckBatchActive(batch);
  return {
    active,
    batchId: batch?.batchId ?? null,
    total: batch?.total ?? 0,
    remaining: batch ? batch.queue.length + (batch.current ? 1 : 0) : 0,
    counts: batch?.counts ?? emptyCounts(),
    stopReason: batch?.stopReason ?? null,
    startedAt: batch?.startedAt ?? null,
    finishedAt: batch?.finishedAt ?? null,
    lastActivityAt: batch?.lastActivityAt ?? null,
    currentName: batch?.current?.name ?? null,
  };
}

// Problems of a finished batch that still wait for an operator decision. A chat the operator already
// moved, snoozed or archived drops out of the list. Primary-key lookups only, at most MAX_PROBLEMS rows.
export async function enrichWaitingCheckProblems(db: D1Database, userId: string, problems: Problem[], now: number) {
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
