import { cleanChatName } from '../chats/bulk-input.ts';
import { readChatState, type ChatState } from '../chats/state.ts';
import { transitionChat } from '../chats/transitions.ts';
import {
  DiscoveryError,
  evaluateDiscoveryCandidate,
  type DiscoveryCandidate,
  type DiscoveryDecision,
} from './domain.ts';

const MIN_TARGET_MEMBERS = 700;
const CHAT_TYPES = ['unknown','group','community','channel','contact','bot'] as const;
const ADS_POLICIES = ['unknown','allowed','inferred_allowed','operator_confirmed','forbidden'] as const;
const ACTIVITY_STATES = ['unknown','active','dead'] as const;
const TOPIC_MATCHES = ['unknown','match','mismatch'] as const;
const INSPECTION_STATUSES = ['inspected','pending','preview','failed'] as const;
const KNOWN_UNAVAILABLE = new Set([
  'whatsapp_chat_missing','whatsapp_banned','invalid_whatsapp_link',
  'viber_chat_missing','viber_banned','invalid_viber_link',
]);

type CandidateRow = {
  id: string;
  user_id: string;
  platform: 'whatsapp' | 'viber' | 'telegram' | 'facebook';
  name: string;
  chat_type: DiscoveryCandidate['chatType'];
  member_count: number | null;
  activity_state: DiscoveryCandidate['activityState'];
  topic_match: DiscoveryCandidate['topicMatch'];
  can_write: number | null;
  ads_policy: DiscoveryCandidate['adsPolicy'];
  membership_state: DiscoveryCandidate['membershipState'];
  access_state: DiscoveryCandidate['accessState'];
  link_state: DiscoveryCandidate['linkState'];
  inspection_state: DiscoveryCandidate['inspectionState'];
  decision: DiscoveryDecision;
  reason_codes_json: string;
  imported_chat_id: string | null;
  version: number;
};

export type DiscoveryInspectionOutcome = {
  candidateId: string;
  chatId: string | null;
  decision: DiscoveryDecision;
  reasonCodes: string[];
  membershipState: DiscoveryCandidate['membershipState'];
  workflowStatus: string;
  needsQualification: boolean;
  needsExternalLeave: boolean;
  autoArchived: boolean;
  version: number;
};

export async function applyDiscoveryInspection(
  db: D1Database,
  userId: string,
  input: { candidateId: string; expectedVersion: number; result: unknown; minMembers?: unknown; requireTargetVerification?: boolean; executorDeviceId?: string },
  now: number,
): Promise<DiscoveryInspectionOutcome> {
  const candidate = await readCandidate(db, userId, input.candidateId);
  if (!candidate) throw new DiscoveryError('Кандидат не знайдений.', 404);
  if (candidate.version !== input.expectedVersion) throw new DiscoveryError('Кандидат уже змінився. Оновіть список.', 409);
  if (candidate.platform !== 'whatsapp' && candidate.platform !== 'viber') {
    throw new DiscoveryError('Автоперевірка доступна лише для WhatsApp і Viber.', 409);
  }

  const result = parseInspectionResult(input.result);
  if (!candidate.imported_chat_id) {
    return applyUnlinkedInspection(db, userId, candidate, result, input.minMembers, now);
  }

  let chat = await readChatState(db, userId, candidate.imported_chat_id);
  if (!chat) throw new DiscoveryError('Пов’язаний чат не знайдений.', 409);
  if (chat.platform !== candidate.platform) throw new DiscoveryError('Платформа кандидата не збігається з чатом.', 409);

  let expectedVersion = candidate.version;
  const reportedMembership = normalizeMembership(result.membershipState);
  const requiresVerifiedTarget = result.accessible === true || result.status === 'inspected'
    || reportedMembership === 'pending' || reportedMembership === 'joined';
  if (input.requireTargetVerification === true && requiresVerifiedTarget && result.targetVerified !== true) {
    throw new DiscoveryError('Executor не підтвердив, що відкрито саме цільовий чат.', 409);
  }
  if (reportedMembership === 'left') {
    throw new DiscoveryError('Вихід із приєднаного чату підтверджується лише через архівний leave-checklist.', 409);
  }
  if (reportedMembership === 'pending' && candidate.platform === 'whatsapp' && chat.workflow_status === 'to_join') {
    const moved = await transitionChat(db, { userId, chat, action:'waiting', accountId:null, now,
      executorFence: executorFence(input, expectedVersion) });
    if (!moved.ok) throw new DiscoveryError(moved.error || 'Стан чату вже змінився. Оновіть список.', 409);
    expectedVersion += 1;
    chat = await requiredChat(db, userId, candidate.imported_chat_id);
  } else if (reportedMembership === 'joined' && (chat.workflow_status === 'to_join' || chat.workflow_status === 'waiting')) {
    const action = chat.workflow_status === 'waiting' ? 'approved' : 'joined';
    const moved = await transitionChat(db, { userId, chat, action, accountId:null, now,
      executorFence: executorFence(input, expectedVersion) });
    if (!moved.ok) throw new DiscoveryError(moved.error || 'Стан чату вже змінився. Оновіть список.', 409);
    expectedVersion += 1;
    chat = await requiredChat(db, userId, candidate.imported_chat_id);
  }

  const current = await readCandidate(db, userId, candidate.id);
  if (!current || current.version !== expectedVersion || current.imported_chat_id !== candidate.imported_chat_id) {
    throw new DiscoveryError('Кандидат змінився під час автоперевірки. Оновіть список.', 409);
  }
  const canonicalMembership = linkedMembershipState(chat, current.membership_state);
  if (reportedMembership && reportedMembership !== canonicalMembership) {
    throw new DiscoveryError('Статус вступу не відповідає фактичному стану чату в Work OS. Оновіть список.', 409);
  }

  const observedName = cleanChatName(result.observedName || '');
  const nextName = observedName && isGeneratedName(current.name) ? observedName : current.name;
  const nextTopic = result.topicMatch ?? 'unknown';
  const reason = (result.reason || '').slice(0, 100);
  const knownUnavailable = result.accessible === false && KNOWN_UNAVAILABLE.has(reason);
  const accessState = result.accessible === true ? 'available'
    : knownUnavailable ? 'unavailable' : current.access_state;
  const linkState = result.accessible === true ? 'valid'
    : knownUnavailable ? 'invalid' : current.link_state;
  const membershipState = canonicalMembership;
  const inspectionState = result.status === 'inspected' ? 'inspected'
    : result.status === 'failed' ? 'failed' : current.inspection_state;
  const chatType = result.chatType ?? current.chat_type;
  const memberCount = result.memberCount !== undefined ? result.memberCount : current.member_count;
  const canWrite = result.canWrite !== undefined ? result.canWrite : (current.can_write === null ? null : Boolean(current.can_write));
  const adsPolicy = result.adsPolicy ?? current.ads_policy;
  const activityState = result.activityState ?? current.activity_state;
  const minMembers = boundedMinMembers(input.minMembers);
  const evaluated = evaluateDiscoveryCandidate({
    chatType,
    memberCount,
    topicMatch: nextTopic,
    canWrite,
    adsPolicy,
    activityState,
    membershipState,
    inspectionState,
    accessState,
    linkState,
  }, minMembers);

  const update = await db.prepare(`UPDATE chat_discovery_candidates SET
    name=?1,checked_at=?2,member_count=?3,chat_type=?4,activity_state=?5,topic_match=?6,
    can_write=?7,ads_policy=?8,membership_state=?9,access_state=?10,link_state=?11,
    inspection_state=?12,decision=?13,reason_codes_json=?14,updated_at=?2,version=version+1
    WHERE id=?15 AND user_id=?16 AND version=?17 AND imported_chat_id=?18
      AND (?19 IS NULL OR (executor_lease_device_id=?19 AND executor_lease_expires_at>?2))
    RETURNING version`)
    .bind(nextName, now, memberCount, chatType, activityState, nextTopic,
      canWrite === null ? null : Number(canWrite), adsPolicy, membershipState, accessState, linkState,
      inspectionState, evaluated.decision, JSON.stringify(evaluated.reasonCodes),
      candidate.id, userId, expectedVersion, candidate.imported_chat_id,input.executorDeviceId??null)
    .first<{ version: number }>();
  if (!update) throw new DiscoveryError('Кандидат змінився під час автоперевірки. Оновіть список.', 409);

  let autoArchived = false;
  let workflowStatus = chat.workflow_status;
  const joinedExternally = membershipState === 'joined';
  if ((evaluated.decision === 'rejected' || evaluated.decision === 'unavailable')
    && chat.workflow_status === 'to_join' && !joinedExternally && membershipState !== 'pending') {
    const freshChat = await requiredChat(db, userId, candidate.imported_chat_id);
    const archived = await transitionChat(db, {
      userId,
      chat: freshChat,
      action:'failed',
      accountId:null,
      now,
      reason:'Автопошук: чат не відповідає критеріям',
      executorFence: executorFence(input, Number(update.version)),
    });
    autoArchived = archived.ok;
    if (archived.ok) workflowStatus = 'archived';
  }

  const finalCandidate = await readCandidate(db, userId, candidate.id);
  if (!finalCandidate) throw new DiscoveryError('Кандидат зник після автоперевірки.', 409);
  if (!autoArchived) workflowStatus = (await requiredChat(db, userId, candidate.imported_chat_id)).workflow_status;

  const needsExternalLeave = membershipState === 'joined'
    && (evaluated.decision === 'rejected' || evaluated.decision === 'unavailable');
  return {
    candidateId: candidate.id,
    chatId: candidate.imported_chat_id,
    decision: evaluated.decision,
    reasonCodes: evaluated.reasonCodes,
    membershipState: finalCandidate.membership_state,
    workflowStatus,
    needsQualification: membershipState === 'joined' && evaluated.decision === 'review',
    needsExternalLeave,
    autoArchived,
    version: finalCandidate.version,
  };
}

async function applyUnlinkedInspection(
  db: D1Database,
  userId: string,
  candidate: CandidateRow,
  result: ReturnType<typeof parseInspectionResult>,
  minMembersInput: unknown,
  now: number,
): Promise<DiscoveryInspectionOutcome> {
  const reportedMembership = normalizeMembership(result.membershipState);
  if (reportedMembership === 'joined' || reportedMembership === 'pending' || reportedMembership === 'left') {
    throw new DiscoveryError('Спочатку додайте чат у Work OS перед фіксацією стану вступу.', 409);
  }
  const observedName = cleanChatName(result.observedName || '');
  const nextName = observedName && isGeneratedName(candidate.name) ? observedName : candidate.name;
  const nextTopic = result.topicMatch ?? 'unknown';
  const reason = (result.reason || '').slice(0, 100);
  const knownUnavailable = result.accessible === false && KNOWN_UNAVAILABLE.has(reason);
  const accessState = result.accessible === true ? 'available'
    : knownUnavailable ? 'unavailable' : candidate.access_state;
  const linkState = result.accessible === true ? 'valid'
    : knownUnavailable ? 'invalid' : candidate.link_state;
  const inspectionState = result.status === 'inspected' ? 'inspected'
    : result.status === 'failed' ? 'failed' : candidate.inspection_state;
  const chatType = result.chatType ?? candidate.chat_type;
  const memberCount = result.memberCount !== undefined ? result.memberCount : candidate.member_count;
  const canWrite = result.canWrite !== undefined ? result.canWrite : (candidate.can_write === null ? null : Boolean(candidate.can_write));
  const adsPolicy = result.adsPolicy ?? candidate.ads_policy;
  const activityState = result.activityState ?? candidate.activity_state;
  const minMembers = boundedMinMembers(minMembersInput);
  const evaluated = evaluateDiscoveryCandidate({
    chatType,
    memberCount,
    topicMatch: nextTopic,
    canWrite,
    adsPolicy,
    activityState,
    membershipState: candidate.membership_state,
    inspectionState,
    accessState,
    linkState,
  }, minMembers);

  const update = await db.prepare(`UPDATE chat_discovery_candidates SET
    name=?1,checked_at=?2,member_count=?3,chat_type=?4,activity_state=?5,topic_match=?6,
    can_write=?7,ads_policy=?8,access_state=?9,link_state=?10,inspection_state=?11,
    decision=?12,reason_codes_json=?13,updated_at=?2,version=version+1
    WHERE id=?14 AND user_id=?15 AND version=?16 AND imported_chat_id IS NULL
    RETURNING version`)
    .bind(nextName, now, memberCount, chatType, activityState, nextTopic,
      canWrite === null ? null : Number(canWrite), adsPolicy, accessState, linkState,
      inspectionState, evaluated.decision, JSON.stringify(evaluated.reasonCodes),
      candidate.id, userId, candidate.version)
    .first<{ version: number }>();
  if (!update) throw new DiscoveryError('Кандидат уже змінився. Оновіть список.', 409);

  return {
    candidateId: candidate.id,
    chatId: null,
    decision: evaluated.decision,
    reasonCodes: evaluated.reasonCodes,
    membershipState: candidate.membership_state,
    workflowStatus: 'not_imported',
    needsQualification: false,
    needsExternalLeave: false,
    autoArchived: false,
    version: update.version,
  };
}

function executorFence(input: {candidateId:string;executorDeviceId?:string}, candidateVersion:number) {
  return input.executorDeviceId ? {candidateId:input.candidateId,candidateVersion,deviceId:input.executorDeviceId} : undefined;
}

function linkedMembershipState(chat: ChatState, fallback: DiscoveryCandidate['membershipState']): DiscoveryCandidate['membershipState'] {
  if (chat.left_at !== null) return 'left';
  if (chat.workflow_status === 'waiting') return 'pending';
  if (chat.joined_at !== null) return 'joined';
  if (chat.workflow_status === 'to_join') return 'not_checked';
  return fallback;
}

function parseInspectionResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DiscoveryError('Некоректний результат автоперевірки.');
  const raw = value as Record<string, unknown>;
  return {
    status: optionalEnum(raw.status, INSPECTION_STATUSES, 'status'),
    accessible: optionalBoolean(raw.accessible, 'accessible'),
    membershipState: optionalString(raw.membershipState, 40, 'membershipState'),
    observedName: optionalString(raw.observedName, 1000, 'observedName'),
    chatType: optionalEnum(raw.chatType, CHAT_TYPES, 'chatType'),
    memberCount: optionalCount(raw.memberCount),
    canWrite: optionalBoolean(raw.canWrite, 'canWrite'),
    adsPolicy: optionalEnum(raw.adsPolicy, ADS_POLICIES, 'adsPolicy'),
    activityState: optionalEnum(raw.activityState, ACTIVITY_STATES, 'activityState'),
    topicMatch: optionalEnum(raw.topicMatch, TOPIC_MATCHES, 'topicMatch'),
    targetVerified: optionalBoolean(raw.targetVerified, 'targetVerified'),
    reason: optionalString(raw.reason, 200, 'reason'),
  };
}

function normalizeMembership(value: string | undefined): DiscoveryCandidate['membershipState'] | null {
  if (value === 'joined' || value === 'pending' || value === 'left' || value === 'not_checked') return value;
  if (value === undefined || value === 'opened' || value === 'request_required' || value === 'join_available') return null;
  throw new DiscoveryError('Некоректний статус вступу.');
}

function optionalBoolean(value: unknown, field: string): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'boolean') throw new DiscoveryError(`Некоректне поле ${field}.`);
  return value;
}

function optionalCount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000_000) throw new DiscoveryError('Некоректна кількість учасників.');
  return Number(value);
}

function optionalString(value: unknown, max: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new DiscoveryError(`Некоректне поле ${field}.`);
  return value.trim();
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new DiscoveryError(`Некоректне поле ${field}.`);
  return value as T;
}

function boundedMinMembers(value: unknown) {
  if (value === undefined || value === null || value === '') return MIN_TARGET_MEMBERS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < MIN_TARGET_MEMBERS || number > 18_000) {
    throw new DiscoveryError(`Мінімум учасників має бути в діапазоні ${MIN_TARGET_MEMBERS}–18 000.`);
  }
  return number;
}

function isGeneratedName(name: string) {
  return !name || /^WhatsApp · |^Viber · /u.test(name) || name === 'Community Landing Page';
}

async function readCandidate(db: D1Database, userId: string, candidateId: string) {
  return db.prepare(`SELECT id,user_id,platform,name,chat_type,member_count,activity_state,topic_match,can_write,
    ads_policy,membership_state,access_state,link_state,inspection_state,decision,reason_codes_json,
    imported_chat_id,version FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(candidateId, userId).first<CandidateRow>();
}

async function requiredChat(db: D1Database, userId: string, chatId: string) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat) throw new DiscoveryError('Пов’язаний чат не знайдений.', 409);
  return chat;
}