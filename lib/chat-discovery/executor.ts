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
  leaseExpiresAt?: number;
  waitingCheckBatchId?: number;
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

export async function readDiscoveryExecutorQueue(
  db: D1Database,
  userId: string,
  limitInput: unknown,
  now = Number.MAX_SAFE_INTEGER,
): Promise<{ tasks: DiscoveryExecutorTask[]; sourceAdvanceNeeded: boolean }> {
  const limit = boundedLimit(limitInput);
  const candidateRows = await db.prepare(`SELECT id,version,platform,name,normalized_link,membership_state,inspection_state,decision,imported_chat_id,checked_at
    FROM chat_discovery_candidates
    WHERE user_id=?1 AND imported_chat_id IS NOT NULL AND membership_state<>'left'
      AND platform IN ('whatsapp','viber')
      AND (
        platform<>'whatsapp'
        OR (membership_state='pending' AND checked_at<0)
        OR (membership_state='not_checked' AND updated_at<=?2)
        OR (membership_state='joined' AND updated_at<=?2
          AND (inspection_state<>'inspected' OR decision IN ('rejected','unavailable')))
      )
    ORDER BY CASE WHEN platform='whatsapp' AND membership_state='pending' THEN 0 ELSE 1 END,
      CASE decision WHEN 'rejected' THEN 0 WHEN 'unavailable' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
      updated_at ASC,id
    LIMIT ?3`).bind(userId, now, limit).all<CandidateTaskRow>();

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
      ...(candidate.platform === 'whatsapp' && candidate.membership_state === 'pending'
        && candidate.checked_at !== null && candidate.checked_at < 0
        ? { waitingCheckBatchId: Math.abs(candidate.checked_at) }
        : {}),
    });
  }
  return { tasks, sourceAdvanceNeeded: false };
}


export async function claimDiscoveryExecutorQueue(
  db: D1Database,
  userId: string,
  deviceId: string,
  limitInput: unknown,
  now: number,
): Promise<{ tasks: DiscoveryExecutorTask[]; leaseSeconds: number; sourceAdvanceNeeded: boolean }> {
  const leaseSeconds = 90;
  const limit = boundedLimit(limitInput);
  const queue = await readDiscoveryExecutorQueue(db, userId, limit, now);
  const tasks: DiscoveryExecutorTask[] = [];
  for (const task of queue.tasks) {
    if (tasks.length >= limit) break;
    const leaseExpiresAt = now + leaseSeconds;
    const claimed = await db.prepare(`UPDATE chat_discovery_candidates
      SET executor_lease_device_id=?1,executor_lease_expires_at=?2,version=version+1
      WHERE id=?3 AND user_id=?4 AND version=?5
        AND (executor_lease_device_id=?1 OR executor_lease_expires_at IS NULL OR executor_lease_expires_at<=?6)
      RETURNING version`)
      .bind(deviceId, leaseExpiresAt, task.candidateId, userId, task.candidateVersion, now)
      .first<{version:number}>();
    if (!claimed) continue;
    tasks.push({ ...task, candidateVersion:Number(claimed.version), leaseExpiresAt });
  }
  return { tasks, leaseSeconds, sourceAdvanceNeeded: queue.sourceAdvanceNeeded };
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

export async function startWaitingWhatsAppCheck(db:D1Database,userId:string,now:number){
  await ensureWaitingWhatsAppCandidates(db,userId,now);
  const batchId=Math.max(1,Math.floor(now));
  const activated=await db.prepare(`UPDATE chat_discovery_candidates
    SET membership_state='pending',inspection_state='not_checked',checked_at=?1,
      executor_lease_device_id=NULL,executor_lease_expires_at=NULL,updated_at=?2,version=version+1
    WHERE user_id=?3 AND platform='whatsapp' AND imported_chat_id IN (
      SELECT id FROM chats
      WHERE user_id=?3 AND platform='whatsapp' AND workflow_status='waiting' AND left_at IS NULL
        AND (snoozed_until IS NULL OR snoozed_until<=?2)
    )
      AND (executor_lease_expires_at IS NULL OR executor_lease_expires_at<=?2)`)
    .bind(-batchId,now,userId).run();
  return {batchId,queued:Number(activated.meta.changes||0)};
}

export async function stopWaitingWhatsAppCheck(db:D1Database,userId:string,batchId:number,now:number){
  const stopped=await db.prepare(`UPDATE chat_discovery_candidates
    SET checked_at=NULL,executor_lease_device_id=NULL,executor_lease_expires_at=NULL,
      updated_at=?1,version=version+1
    WHERE user_id=?2 AND platform='whatsapp' AND membership_state='pending'
      AND checked_at=?3`)
    .bind(now,userId,-Math.abs(batchId)).run();
  return {stopped:Number(stopped.meta.changes||0)};
}

export async function pauseWaitingWhatsAppCheckBatch(db:D1Database,userId:string,batchId:number,now:number){
  return stopWaitingWhatsAppCheck(db,userId,batchId,now);
}

export async function readWaitingWhatsAppCheckStatus(db:D1Database,userId:string){
  const row=await db.prepare(`SELECT COUNT(*) AS remaining,MIN(checked_at) AS marker
    FROM chat_discovery_candidates
    WHERE user_id=?1 AND platform='whatsapp' AND membership_state='pending' AND checked_at<0`)
    .bind(userId).first<{remaining:number;marker:number|null}>();
  const remaining=Number(row?.remaining||0);
  return {active:remaining>0,remaining,batchId:row?.marker===null?null:Math.abs(Number(row?.marker))};
}

async function ensureWaitingWhatsAppCandidates(db:D1Database,userId:string,now:number){
  await db.prepare(`INSERT OR IGNORE INTO chat_discovery_candidates(
    id,user_id,platform,name,link,normalized_link,discovered_at,
    membership_state,inspection_state,decision,reason_codes_json,
    imported_chat_id,created_at,updated_at
  )
  SELECT 'waiting-' || c.id,c.user_id,'whatsapp',c.name,c.normalized_link,c.normalized_link,?2,
    'pending','not_checked','review','[]',c.id,?2,?2
  FROM chats c
  WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='waiting'
    AND c.joined_at IS NULL AND c.left_at IS NULL
    AND c.normalized_link LIKE 'https://chat.whatsapp.com/%'
    AND NOT EXISTS(
      SELECT 1 FROM chat_discovery_candidates dc
      WHERE dc.user_id=c.user_id AND dc.platform='whatsapp' AND dc.normalized_link=c.normalized_link
    )`).bind(userId,now).run();

  await db.prepare(`UPDATE chat_discovery_candidates
    SET imported_chat_id=(
      SELECT c.id FROM chats c
      WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='waiting'
        AND c.joined_at IS NULL AND c.left_at IS NULL
        AND c.normalized_link=chat_discovery_candidates.normalized_link
      ORDER BY c.updated_at,c.id LIMIT 1
    ),
      membership_state='pending',inspection_state='not_checked',
      updated_at=?2,version=version+1
    WHERE user_id=?1 AND platform='whatsapp' AND imported_chat_id IS NULL
      AND EXISTS(
        SELECT 1 FROM chats c
        WHERE c.user_id=?1 AND c.platform='whatsapp' AND c.workflow_status='waiting'
          AND c.joined_at IS NULL AND c.left_at IS NULL
          AND c.normalized_link=chat_discovery_candidates.normalized_link
      )`).bind(userId,now).run();
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
