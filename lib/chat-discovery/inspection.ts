import { cleanChatName } from '../chats/bulk-input.ts';
import { readChatState } from '../chats/state.ts';
import { transitionChat } from '../chats/transitions.ts';
import {
  DiscoveryError,
  evaluateDiscoveryCandidate,
  inferDiscoveryTopicMatch,
  type DiscoveryCandidate,
  type DiscoveryDecision,
} from './domain.ts';
import type { DiscoverySource } from './public-web.ts';

const MIN_TARGET_MEMBERS = 700;
const CHAT_TYPES = ['unknown','group','community','channel','contact','bot'] as const;
const ADS_POLICIES = ['unknown','allowed','inferred_allowed','operator_confirmed','forbidden'] as const;
const ACTIVITY_STATES = ['unknown','active','dead'] as const;
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

type SourceRow = {
  source_kind: DiscoverySource['kind'];
  source_url: string;
  source_title: string;
  query_text: string;
  seed_label: string;
  seed_kind: string;
  context: string;
};

export type DiscoveryInspectionOutcome = {
  candidateId: string;
  chatId: string;
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
  input: { candidateId: string; expectedVersion: number; result: unknown; minMembers?: unknown },
  now: number,
): Promise<DiscoveryInspectionOutcome> {
  const candidate = await readCandidate(db, userId, input.candidateId);
  if (!candidate) throw new DiscoveryError('Кандидат не знайдений.', 404);
  if (candidate.version !== input.expectedVersion) throw new DiscoveryError('Кандидат уже змінився. Оновіть список.', 409);
  if (!candidate.imported_chat_id) throw new DiscoveryError('Спочатку додайте кандидата у Work OS.', 409);
  if (candidate.platform !== 'whatsapp' && candidate.platform !== 'viber') {
    throw new DiscoveryError('Автоперевірка доступна лише для WhatsApp і Viber.', 409);
  }

  const result = parseInspectionResult(input.result);
  let chat = await readChatState(db, userId, candidate.imported_chat_id);
  if (!chat) throw new DiscoveryError('Пов’язаний чат не знайдений.', 409);
  if (chat.platform !== candidate.platform) throw new DiscoveryError('Платформа кандидата не збігається з чатом.', 409);

  let expectedVersion = candidate.version;
  const reportedMembership = normalizeMembership(result.membershipState);
  if (reportedMembership === 'pending' && candidate.platform === 'whatsapp' && chat.workflow_status === 'to_join') {
    const moved = await transitionChat(db, { userId, chat, action:'waiting', accountId:null, now });
    if (!moved.ok) throw new DiscoveryError(moved.error || 'Стан чату вже змінився. Оновіть список.', 409);
    expectedVersion += 1;
    chat = await requiredChat(db, userId, candidate.imported_chat_id);
  } else if (reportedMembership === 'joined' && (chat.workflow_status === 'to_join' || chat.workflow_status === 'waiting')) {
    const action = chat.workflow_status === 'waiting' ? 'approved' : 'joined';
    const moved = await transitionChat(db, { userId, chat, action, accountId:null, now });
    if (!moved.ok) throw new DiscoveryError(moved.error || 'Стан чату вже змінився. Оновіть список.', 409);
    expectedVersion += 1;
    chat = await requiredChat(db, userId, candidate.imported_chat_id);
  }

  const current = await readCandidate(db, userId, candidate.id);
  if (!current || current.version !== expectedVersion || current.imported_chat_id !== candidate.imported_chat_id) {
    throw new DiscoveryError('Кандидат змінився під час автоперевірки. Оновіть список.', 409);
  }

  const sources = await readCandidateSources(db, userId, candidate.id);
  const observedName = cleanChatName(result.observedName || '');
  const nextName = observedName && isGeneratedName(current.name) ? observedName : current.name;
  const inferredTopic = inferDiscoveryTopicMatch(nextName, sources);
  const nextTopic = inferredTopic === 'unknown' ? current.topic_match : inferredTopic;
  const reason = (result.reason || '').slice(0, 100);
  const knownUnavailable = result.accessible === false && KNOWN_UNAVAILABLE.has(reason);
  const accessState = result.accessible === true ? 'available'
    : knownUnavailable ? 'unavailable' : current.access_state;
  const linkState = result.accessible === true ? 'valid'
    : knownUnavailable ? 'invalid' : current.link_state;
  const membershipState = reportedMembership || current.membership_state;
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
    accessState,
    linkState,
  }, minMembers);

  const update = await db.prepare(`UPDATE chat_discovery_candidates SET
    name=?1,checked_at=?2,member_count=?3,chat_type=?4,activity_state=?5,topic_match=?6,
    can_write=?7,ads_policy=?8,membership_state=?9,access_state=?10,link_state=?11,
    inspection_state=?12,decision=?13,reason_codes_json=?14,updated_at=?2,version=version+1
    WHERE id=?15 AND user_id=?16 AND version=?17 AND imported_chat_id=?18
    RETURNING version`)
    .bind(nextName, now, memberCount, chatType, activityState, nextTopic,
      canWrite === null ? null : Number(canWrite), adsPolicy, membershipState, accessState, linkState,
      inspectionState, evaluated.decision, JSON.stringify(evaluated.reasonCodes),
      candidate.id, userId, expectedVersion, candidate.imported_chat_id)
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
  if (!Number.isSafeInteger(number) || number < MIN_TARGET_MEMBERS || number > 10_000_000) {
    throw new DiscoveryError(`Мінімум учасників не може бути меншим за ${MIN_TARGET_MEMBERS}.`);
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

async function readCandidateSources(db: D1Database, userId: string, candidateId: string): Promise<DiscoverySource[]> {
  const result = await db.prepare(`SELECT source_kind,source_url,source_title,query_text,seed_label,seed_kind,context
    FROM chat_discovery_sources WHERE candidate_id=?1 AND user_id=?2 ORDER BY discovered_at DESC,id LIMIT 12`)
    .bind(candidateId, userId).all<SourceRow>();
  return result.results.map(row => ({
    kind: row.source_kind,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    query: row.query_text,
    seedLabel: row.seed_label,
    seedKind: row.seed_kind,
    context: row.context,
  }));
}

async function requiredChat(db: D1Database, userId: string, chatId: string) {
  const chat = await readChatState(db, userId, chatId);
  if (!chat) throw new DiscoveryError('Пов’язаний чат не знайдений.', 409);
  return chat;
}
