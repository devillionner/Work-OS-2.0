import { readChatState } from '../chats/state.ts';
import { transitionChat } from '../chats/transitions.ts';
import { changeChatLeave } from '../chats/leave.ts';
import { supportsChatLeaveChecklist } from '../chats/leave-policy.ts';
import { DiscoveryError, type DiscoveryDecision } from './domain.ts';

export type DiscoveryExecutorAction =
  | 'join_and_inspect'
  | 'check_membership_and_inspect'
  | 'inspect'
  | 'leave';

export type DiscoveryExecutorTask = {
  candidateId: string;
  candidateVersion: number;
  chatId: string;
  chatStateToken: string;
  platform: 'whatsapp' | 'viber';
  name: string;
  link: string;
  action: DiscoveryExecutorAction;
  decision: DiscoveryDecision;
  minMembers: number;
  resultAction: 'inspect' | 'executor-leave';
  leaseExpiresAt?: number;
};

type CandidateTaskRow = {
  id: string;
  version: number;
  platform: 'whatsapp' | 'viber';
  name: string;
  normalized_link: string;
  membership_state: 'not_checked' | 'pending' | 'joined' | 'left';
  inspection_state: 'not_checked' | 'inspected' | 'failed';
  decision: DiscoveryDecision;
  imported_chat_id: string;
};

export async function readDiscoveryExecutorQueue(
  db: D1Database,
  userId: string,
  limitInput: unknown,
): Promise<{ tasks: DiscoveryExecutorTask[] }> {
  const limit = boundedLimit(limitInput);
  const [candidateRows, latestRun] = await Promise.all([
    db.prepare(`SELECT id,version,platform,name,normalized_link,membership_state,inspection_state,decision,imported_chat_id
      FROM chat_discovery_candidates
      WHERE user_id=?1 AND imported_chat_id IS NOT NULL AND membership_state<>'left'
        AND platform IN ('whatsapp','viber')
      ORDER BY CASE WHEN platform='whatsapp' AND membership_state='pending' THEN 0 ELSE 1 END,
        CASE decision WHEN 'rejected' THEN 0 WHEN 'unavailable' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
        updated_at ASC,id
      LIMIT ?2`).bind(userId, Math.max(limit * 3, 20)).all<CandidateTaskRow>(),
    db.prepare(`SELECT min_members FROM chat_discovery_runs WHERE user_id=?1 ORDER BY updated_at DESC LIMIT 1`)
      .bind(userId).first<{ min_members: number }>(),
  ]);

  const tasks: DiscoveryExecutorTask[] = [];
  for (const candidate of candidateRows.results) {
    if (tasks.length >= limit) break;
    const chat = await readChatState(db, userId, candidate.imported_chat_id);
    if (!chat || chat.platform !== candidate.platform || chat.left_at !== null) continue;
    const action = deriveAction(candidate, chat.workflow_status);
    if (!action) continue;
    tasks.push({
      candidateId: candidate.id,
      candidateVersion: candidate.version,
      chatId: chat.id,
      chatStateToken: chat.state_token,
      platform: candidate.platform,
      name: candidate.name,
      link: candidate.normalized_link,
      action,
      decision: candidate.decision,
      minMembers: Number(latestRun?.min_members || 700),
      resultAction: action === 'leave' ? 'executor-leave' : 'inspect',
    });
  }
  return { tasks };
}


export async function claimDiscoveryExecutorQueue(
  db: D1Database,
  userId: string,
  deviceId: string,
  limitInput: unknown,
  now: number,
): Promise<{ tasks: DiscoveryExecutorTask[]; leaseSeconds: number }> {
  const leaseSeconds = 90;
  const limit = boundedLimit(limitInput);
  const queue = await readDiscoveryExecutorQueue(db, userId, Math.max(limit * 3, 20));
  const tasks: DiscoveryExecutorTask[] = [];
  for (const task of queue.tasks) {
    if (tasks.length >= limit) break;
    const leaseExpiresAt = now + leaseSeconds;
    const claimed = await db.prepare(`UPDATE chat_discovery_candidates
      SET executor_lease_device_id=?1,executor_lease_expires_at=?2
      WHERE id=?3 AND user_id=?4 AND version=?5
        AND (executor_lease_device_id=?1 OR executor_lease_expires_at IS NULL OR executor_lease_expires_at<=?6)`)
      .bind(deviceId, leaseExpiresAt, task.candidateId, userId, task.candidateVersion, now).run();
    if (Number(claimed.meta.changes || 0) !== 1) continue;
    tasks.push({ ...task, leaseExpiresAt });
  }
  return { tasks, leaseSeconds };
}

export async function assertDiscoveryExecutorLease(
  db: D1Database,
  userId: string,
  deviceId: string,
  candidateId: string,
  expectedVersion: number,
  now: number,
) {
  const lease = await db.prepare(`SELECT executor_lease_device_id,executor_lease_expires_at
    FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 AND version=?3 LIMIT 1`)
    .bind(candidateId, userId, expectedVersion)
    .first<{executor_lease_device_id:string|null;executor_lease_expires_at:number|null}>();
  if (!lease || lease.executor_lease_device_id !== deviceId || !lease.executor_lease_expires_at || lease.executor_lease_expires_at <= now) {
    throw new DiscoveryError('Задача executor більше не належить цьому пристрою. Оновіть чергу.', 409);
  }
}

export async function completeDiscoveryExternalLeave(
  db: D1Database,
  userId: string,
  input: { candidateId: string; expectedVersion: number; chatStateToken: string },
  now: number,
) {
  const candidate = await db.prepare(`SELECT id,version,decision,membership_state,imported_chat_id
    FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(input.candidateId, userId)
    .first<{ id:string;version:number;decision:DiscoveryDecision;membership_state:string;imported_chat_id:string|null }>();
  if (!candidate || !candidate.imported_chat_id) throw new DiscoveryError('Кандидат або пов’язаний чат не знайдений.', 404);
  if (candidate.version !== input.expectedVersion) throw new DiscoveryError('Кандидат уже змінився. Оновіть задачу executor.', 409);
  if (!['rejected','unavailable'].includes(candidate.decision) || candidate.membership_state !== 'joined') {
    throw new DiscoveryError('Підтверджений зовнішній вихід зараз не очікується.', 409);
  }

  let chat = await readChatState(db, userId, candidate.imported_chat_id);
  if (!chat || chat.state_token !== input.chatStateToken) throw new DiscoveryError('Чат уже змінився. Оновіть задачу executor.', 409);
  if (!supportsChatLeaveChecklist(chat.platform) || !['whatsapp','viber'].includes(chat.platform)) {
    throw new DiscoveryError('Executor-вихід зараз дозволений лише для WhatsApp/Viber.', 409);
  }

  if (chat.workflow_status !== 'archived') {
    const archived = await transitionChat(db, {
      userId,
      chat,
      action: 'archive',
      accountId: null,
      now,
      reason: 'Автопошук: чат не відповідає критеріям',
    });
    if (!archived.ok) throw new DiscoveryError(archived.error || 'Не вдалося архівувати чат після зовнішнього виходу.', 409);
    chat = await readChatState(db, userId, candidate.imported_chat_id);
    if (!chat) throw new DiscoveryError('Чат зник після архівації.', 409);
  }

  const left = await changeChatLeave(db, { userId, chat, now, confirm: true });
  if (!left.ok) throw new DiscoveryError(left.error || 'Не вдалося підтвердити зовнішній вихід.', 409);
  return { ok: true, candidateId: candidate.id, chatId: chat.id };
}

function deriveAction(candidate: CandidateTaskRow, workflowStatus: string): DiscoveryExecutorAction | null {
  if ((candidate.decision === 'rejected' || candidate.decision === 'unavailable') && candidate.membership_state === 'joined') {
    return supportsChatLeaveChecklist(candidate.platform) ? 'leave' : null;
  }
  if (workflowStatus === 'archived') return null;
  if (workflowStatus === 'to_join' && candidate.membership_state === 'not_checked') return 'join_and_inspect';
  if (workflowStatus === 'waiting' || candidate.membership_state === 'pending') return 'check_membership_and_inspect';
  if (candidate.membership_state === 'joined' && (candidate.decision === 'review' || candidate.inspection_state !== 'inspected')) return 'inspect';
  return null;
}

function boundedLimit(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(20, number)) : 10;
}
