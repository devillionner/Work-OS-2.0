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
  runtime: 'whatsapp_web' | 'viber_native';
  expectedTarget: { name: string; link: string };
  safety: { requiresTargetVerification: true; unknownState: 'fail_closed' };
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
  checked_at: number | null;
};

// A failed or unfinished attempt must not be retried on the very next poll. The last attempt time is
// already stored in checked_at, so pacing needs no extra column (staging may lack newer migrations).
const RETRY_AFTER_ATTEMPT_SECONDS = 300;
const REINSPECT_JOINED_SECONDS = 600;
// Rows with this id prefix were created only as carriers for the retired candidate-based Waiting
// check (v0.2.84–v0.2.88). They are not Discovery results, so they must never drive automated
// re-inspection or leave of the operator's own chats.
export const RETIRED_WAITING_CHECK_CANDIDATE_SQL = `id LIKE 'waiting-%'`;


export function discoveryExecutorQueueStatement(db: D1Database, userId: string, now: number, limit: number) {
  // Three branches, each a range of the (user_id,platform,membership_state,…) index, instead of one
  // filter over every candidate the owner ever had: left and pending WhatsApp candidates — usually most
  // of them — are never read. The result set and order are the same as the single-filter query.
  const columns = 'id,version,platform,name,normalized_link,membership_state,inspection_state,decision,imported_chat_id,checked_at,updated_at';
  // Unary + keeps SQLite off the imported_chat_id index, which would range over every platform.
  const owned = `user_id=?1 AND +imported_chat_id IS NOT NULL AND NOT (${RETIRED_WAITING_CHECK_CANDIDATE_SQL})`;
  return db.prepare(`SELECT ${columns} FROM (
      SELECT ${columns} FROM chat_discovery_candidates
        WHERE ${owned} AND platform='viber' AND membership_state<>'left'
      UNION ALL
      SELECT ${columns} FROM chat_discovery_candidates
        WHERE ${owned} AND platform='whatsapp' AND membership_state='not_checked'
          AND (checked_at IS NULL OR checked_at<=?2-${RETRY_AFTER_ATTEMPT_SECONDS})
      UNION ALL
      SELECT ${columns} FROM chat_discovery_candidates
        WHERE ${owned} AND platform='whatsapp' AND membership_state='joined' AND (
          decision IN ('rejected','unavailable')
          OR ((decision='review' OR inspection_state<>'inspected')
            AND (checked_at IS NULL OR checked_at<=?2-${REINSPECT_JOINED_SECONDS}))
        )
    )
    ORDER BY CASE decision WHEN 'rejected' THEN 0 WHEN 'unavailable' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
      updated_at ASC,id
    LIMIT ?3`).bind(userId, now, limit);
}

export async function readDiscoveryExecutorQueue(
  db: D1Database,
  userId: string,
  limitInput: unknown,
  now = Number.MAX_SAFE_INTEGER,
): Promise<{ tasks: DiscoveryExecutorTask[]; sourceAdvanceNeeded: boolean }> {
  const limit = boundedLimit(limitInput);
  const candidateRows = await discoveryExecutorQueueStatement(db, userId, now, limit).all<CandidateTaskRow>();

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
      minMembers: 700,
      resultAction: action === 'leave' ? 'executor-leave' : 'inspect',
      runtime: candidate.platform === 'whatsapp' ? 'whatsapp_web' : 'viber_native',
      expectedTarget: { name: candidate.name, link: candidate.normalized_link },
      safety: { requiresTargetVerification: true, unknownState: 'fail_closed' },
    });
  }
  return { tasks, sourceAdvanceNeeded: false };
}


export async function completeDiscoveryExternalLeave(
  db: D1Database,
  userId: string,
  input: { candidateId: string; expectedVersion: number; chatStateToken: string; targetVerified?: unknown },
  now: number,
) {
  if (input.targetVerified !== true) throw new DiscoveryError('Executor не підтвердив, що відкрито саме цільовий чат.', 409);
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
