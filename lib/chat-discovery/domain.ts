import { businessDate } from '../business-time.ts';
import { cleanChatName, normalizeGroupLink, suggestedChatName, type ChatPlatform } from '../chats/bulk-input.ts';
import { buildPublicSearchTasks, buildTelegramSearchPlan, type DiscoveryPlatform, type DiscoverySource, type TelegramSearchPlan } from './public-web.ts';

export type DiscoveryDecision = 'review' | 'target' | 'rejected' | 'unavailable';
export type DiscoveryRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type DiscoveryRun = {
  id: string;
  status: DiscoveryRunStatus;
  platforms: DiscoveryPlatform[];
  goal: number;
  minMembers: number;
  cursor: number;
  telegramCursor: number;
  searchedQueries: number;
  foundCount: number;
  duplicateCount: number;
  importedCount: number;
  targetCount: number;
  completionReason: 'goal_reached' | 'sources_exhausted' | null;
  errorMessage: string;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  version: number;
};

export type DiscoveryCandidate = {
  id: string;
  platform: ChatPlatform;
  name: string;
  link: string;
  discoveredAt: number;
  checkedAt: number | null;
  memberCount: number | null;
  chatType: 'unknown' | 'group' | 'community' | 'channel' | 'contact' | 'bot';
  activityState: 'unknown' | 'active' | 'dead';
  topicMatch: 'unknown' | 'match' | 'mismatch';
  canWrite: boolean | null;
  adsPolicy: 'unknown' | 'allowed' | 'inferred_allowed' | 'operator_confirmed' | 'forbidden';
  membershipState: 'not_checked' | 'pending' | 'joined' | 'left';
  accessState: 'unknown' | 'available' | 'unavailable';
  linkState: 'unknown' | 'valid' | 'invalid';
  inspectionState: 'not_checked' | 'inspected' | 'failed';
  decision: DiscoveryDecision;
  reasonCodes: string[];
  importedChatId: string | null;
  updatedAt: number;
  version: number;
  sources: DiscoverySource[];
};

export class DiscoveryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'DiscoveryError';
    this.status = status;
  }
}

type RunRow = {
  id: string; status: DiscoveryRunStatus; platforms_json: string; goal: number; min_members: number;
  source_cursor: number; telegram_cursor: number; searched_queries: number; found_count: number; duplicate_count: number;
  imported_count: number; target_count: number; completion_reason: string | null; error_message: string | null; started_at: number; updated_at: number;
  completed_at: number | null; version: number; source_lease_device_id: string | null; source_lease_expires_at: number | null;
};
type CandidateRow = {
  id: string; platform: ChatPlatform; name: string; link: string; normalized_link: string;
  discovered_at: number; checked_at: number | null; member_count: number | null;
  chat_type: DiscoveryCandidate['chatType']; activity_state: DiscoveryCandidate['activityState'];
  topic_match: DiscoveryCandidate['topicMatch']; can_write: number | null;
  ads_policy: DiscoveryCandidate['adsPolicy']; membership_state: DiscoveryCandidate['membershipState'];
  access_state: DiscoveryCandidate['accessState']; link_state: DiscoveryCandidate['linkState'];
  inspection_state: DiscoveryCandidate['inspectionState']; decision: DiscoveryDecision;
  reason_codes_json: string; imported_chat_id: string | null; discovery_run_id: string | null; updated_at: number; version: number;
};
type SourceRow = {
  candidate_id: string; source_kind: DiscoverySource['kind']; source_url: string; source_title: string;
  query_text: string; seed_label: string; seed_kind: string; context: string;
};
type ExistingChat = { id: string; platform: string; link: string; normalized_link: string; workflow_status: string };

export async function reconcileDiscoveryRunGoal(
  db: D1Database,
  userId: string,
  runId: string,
  now: number,
): Promise<DiscoveryRun> {
  const row = await readRun(db, userId, runId);
  if (!row) throw new DiscoveryError('Запуск пошуку не знайдено.', 404);
  const target = await db.prepare(`SELECT COUNT(*) AS count FROM chat_discovery_candidates
    WHERE user_id=?1 AND discovery_run_id=?2 AND decision='target'`).bind(userId, runId).first<{count:number}>();
  const targetCount = Number(target?.count || 0);
  const telegramDone = buildTelegramSearchPlan(row.telegram_cursor, 1).done;
  const publicDone = row.source_cursor >= buildPublicSearchTasks(parsePlatforms(row.platforms_json)).length;
  const completionReason = targetCount >= row.goal ? 'goal_reached'
    : telegramDone && publicDone ? 'sources_exhausted' : null;
  if (row.status === 'running' || (row.status === 'completed' && row.completion_reason === 'sources_exhausted')) {
    const finalReason = targetCount >= row.goal ? 'goal_reached'
      : row.status === 'completed' ? 'sources_exhausted' : completionReason;
    const finalStatus = finalReason ? 'completed' : 'running';
    await db.prepare(`UPDATE chat_discovery_runs SET target_count=?1,completion_reason=?2,
      status=?3,completed_at=?4,updated_at=?5,
      source_lease_device_id=CASE WHEN ?3='completed' THEN NULL ELSE source_lease_device_id END,
      source_lease_expires_at=CASE WHEN ?3='completed' THEN NULL ELSE source_lease_expires_at END,
      version=version+1
      WHERE id=?6 AND user_id=?7 AND status IN ('running','completed')`)
      .bind(targetCount, finalReason, finalStatus,
        finalReason ? (row.completed_at || now) : null, now, runId, userId).run();
  }
  const fresh = await readRun(db, userId, runId);
  if (!fresh) throw new DiscoveryError('Запуск пошуку зник.', 404);
  return mapRun(fresh);
}

export async function readDiscoveryWorkspace(
  db: D1Database,
  userId: string,
  input: { decision?: string | null; waitingWhatsApp?: boolean; limit?: number } = {},
): Promise<{ run: DiscoveryRun | null; telegramPlan: TelegramSearchPlan | null; counts: Record<DiscoveryDecision, number>; importedCount: number; waitingWhatsAppCount: number; candidates: DiscoveryCandidate[] }> {
  const decision = ['review', 'target', 'rejected', 'unavailable'].includes(input.decision || '') ? input.decision! : null;
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 60));
  const [run, countsResult, importedResult, waitingWhatsAppResult, candidateResult] = await Promise.all([
    latestRun(db, userId),
    db.prepare(`SELECT decision,COUNT(*) AS count FROM chat_discovery_candidates WHERE user_id=?1 GROUP BY decision`).bind(userId).all<{ decision: DiscoveryDecision; count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM chat_discovery_candidates WHERE user_id=?1 AND imported_chat_id IS NOT NULL`).bind(userId).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM chat_discovery_candidates WHERE user_id=?1 AND platform='whatsapp' AND membership_state='pending' AND imported_chat_id IS NOT NULL`).bind(userId).first<{ count: number }>(),
    input.waitingWhatsApp
      ? db.prepare(`SELECT * FROM chat_discovery_candidates WHERE user_id=?1 AND platform='whatsapp' AND membership_state='pending' AND imported_chat_id IS NOT NULL ORDER BY updated_at ASC,id LIMIT ?2`).bind(userId, limit).all<CandidateRow>()
      : decision
      ? db.prepare(`SELECT * FROM chat_discovery_candidates WHERE user_id=?1 AND decision=?2 ORDER BY updated_at DESC,id LIMIT ?3`).bind(userId, decision, limit).all<CandidateRow>()
      : db.prepare(`SELECT * FROM chat_discovery_candidates WHERE user_id=?1 ORDER BY
          CASE decision WHEN 'target' THEN 0 WHEN 'review' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
          updated_at DESC,id LIMIT ?2`).bind(userId, limit).all<CandidateRow>(),
  ]);

  const candidates = candidateResult.results;
  const sources = await readSources(db, userId, candidates.map((candidate) => candidate.id));
  const counts: Record<DiscoveryDecision, number> = { review: 0, target: 0, rejected: 0, unavailable: 0 };
  for (const item of countsResult.results) counts[item.decision] = Number(item.count) || 0;
  return {
    run: run ? mapRun(run) : null,
    telegramPlan: run ? buildTelegramSearchPlan(run.telegram_cursor, 6) : null,
    counts,
    importedCount: Number(importedResult?.count || 0),
    waitingWhatsAppCount: Number(waitingWhatsAppResult?.count || 0),
    candidates: candidates.map((candidate) => mapCandidate(candidate, sources.get(candidate.id) || [])),
  };
}

export async function handoffDiscoveryCandidate(
  db: D1Database,
  userId: string,
  candidateId: string,
  expectedVersion: number,
  now: number,
): Promise<{ chatId: string; existing: boolean; workflowStatus: string }> {
  const candidate = await db.prepare(`SELECT * FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(candidateId, userId).first<CandidateRow>();
  if (!candidate) throw new DiscoveryError('Кандидат не знайдений.', 404);
  if (candidate.imported_chat_id) {
    const existing = await db.prepare(`SELECT id,workflow_status FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`)
      .bind(candidate.imported_chat_id, userId).first<{ id: string; workflow_status: string }>();
    if (existing) return { chatId: existing.id, existing: true, workflowStatus: existing.workflow_status };
  }
  if (candidate.version !== expectedVersion) throw new DiscoveryError('Кандидат змінився в іншій вкладці. Оновіть список.', 409);
  if (candidate.decision === 'rejected' || candidate.decision === 'unavailable') {
    throw new DiscoveryError('Відхилений або недоступний кандидат не можна додати на перевірку.', 409);
  }
  const parsed = normalizeGroupLink(candidate.normalized_link);
  if (!parsed) throw new DiscoveryError('Посилання кандидата більше не є валідним.', 409);

  const existing = await findExistingChat(db, userId, parsed.platform, parsed.link);
  if (existing) {
    const update = await db.prepare(`UPDATE chat_discovery_candidates
      SET imported_chat_id=?1,updated_at=?2,version=version+1
      WHERE id=?3 AND user_id=?4 AND version=?5 AND imported_chat_id IS NULL RETURNING id`)
      .bind(existing.id, now, candidate.id, userId, expectedVersion).all<{ id: string }>();
    if (!update.results.length) throw new DiscoveryError('Кандидат змінився в іншій вкладці. Оновіть список.', 409);
    return { chatId: existing.id, existing: true, workflowStatus: existing.workflow_status };
  }

  const chatId = crypto.randomUUID();
  const name = cleanChatName(candidate.name) || suggestedChatName(parsed);
  const sourceCount = await db.prepare(`SELECT COUNT(*) AS count FROM chat_discovery_sources WHERE candidate_id=?1 AND user_id=?2`)
    .bind(candidate.id, userId).first<{ count: number }>();
  const sourceKey = `chat-discovery-import:${candidate.id}`;
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
        SELECT ?1,?2,?3,?4,?5,?5,'to_join',?6,?7,?7
        WHERE EXISTS(
          SELECT 1 FROM chat_discovery_candidates
          WHERE id=?8 AND user_id=?2 AND version=?9 AND imported_chat_id IS NULL
            AND decision IN ('review','target')
        ) RETURNING id`)
        .bind(chatId, userId, parsed.platform, name, parsed.link, Number(parsed.private), now, candidate.id, expectedVersion),
      db.prepare(`UPDATE chat_discovery_candidates SET imported_chat_id=?1,updated_at=?2,version=version+1
        WHERE id=?3 AND user_id=?4 AND version=?5 AND imported_chat_id IS NULL
          AND EXISTS(SELECT 1 FROM chats WHERE id=?1 AND user_id=?4) RETURNING id`)
        .bind(chatId, now, candidate.id, userId, expectedVersion),
      db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
        SELECT ?1,?2,'chat_discovery_imported',?3,?4,?5,?6,?7,?8 WHERE changes()=1`)
        .bind(crypto.randomUUID(), userId, parsed.platform, chatId, now, businessDate(now),
          JSON.stringify({ candidateId: candidate.id, sourceCount: Number(sourceCount?.count || 0) }), sourceKey),
    ]);
    if (results[0].results.length !== 1 || results[1].results.length !== 1) {
      throw new DiscoveryError('Кандидат змінився під час додавання. Оновіть список.', 409);
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    const raced = await findExistingChat(db, userId, parsed.platform, parsed.link);
    if (raced) return { chatId: raced.id, existing: true, workflowStatus: raced.workflow_status };
    throw new DiscoveryError('Не вдалося додати чат на перевірку. Спробуйте ще раз.', 500);
  }

  await db.prepare(`UPDATE chat_discovery_runs SET imported_count=imported_count+1,updated_at=?1,version=version+1
    WHERE user_id=?2 AND status='running'`).bind(now, userId).run();
  return { chatId, existing: false, workflowStatus: 'to_join' };
}

export async function archiveDiscoveryCandidateForOperator(
  db:D1Database,userId:string,candidateId:string,expectedVersion:number,now:number,
){
  const candidate=await db.prepare(`SELECT id,version,imported_chat_id,decision,membership_state
    FROM chat_discovery_candidates WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(candidateId,userId)
    .first<{id:string;version:number;imported_chat_id:string|null;decision:DiscoveryDecision;membership_state:DiscoveryCandidate['membershipState']}>();
  if(!candidate)throw new DiscoveryError('Кандидат не знайдений.',404);
  if(candidate.imported_chat_id)throw new DiscoveryError('Цей чат уже доданий у Work OS. Архівуйте його зі звичайної черги чатів.',409);
  if(candidate.version!==expectedVersion)throw new DiscoveryError('Кандидат змінився в іншій вкладці. Оновіть список.',409);
  if(candidate.decision==='rejected'||candidate.decision==='unavailable'){
    return {archived:true,candidateId:candidate.id,needsExternalLeave:candidate.membership_state==='joined',version:candidate.version};
  }
  const updated=await db.prepare(`UPDATE chat_discovery_candidates
    SET decision='rejected',reason_codes_json='["operator_rejected"]',
        checked_at=COALESCE(checked_at,?1),updated_at=?1,version=version+1
    WHERE id=?2 AND user_id=?3 AND version=?4 AND imported_chat_id IS NULL
    RETURNING version`)
    .bind(now,candidate.id,userId,expectedVersion)
    .first<{version:number}>();
  if(!updated)throw new DiscoveryError('Кандидат уже змінився. Оновіть список.',409);
  return {
    archived:true,
    candidateId:candidate.id,
    needsExternalLeave:candidate.membership_state==='joined',
    version:Number(updated.version),
  };
}

export function evaluateDiscoveryCandidate(input: {
  chatType?: DiscoveryCandidate['chatType'];
  memberCount?: number | null;
  topicMatch?: DiscoveryCandidate['topicMatch'];
  canWrite?: boolean | null;
  adsPolicy?: DiscoveryCandidate['adsPolicy'];
  activityState?: DiscoveryCandidate['activityState'];
  accessState?: DiscoveryCandidate['accessState'];
  linkState?: DiscoveryCandidate['linkState'];
  membershipState?: DiscoveryCandidate['membershipState'];
  inspectionState?: DiscoveryCandidate['inspectionState'];
}, minMembers = 700, maxMembers = 18_000): { decision: DiscoveryDecision; reasonCodes: string[] } {
  if (input.linkState === 'invalid') return { decision: 'unavailable', reasonCodes: ['invalid_invite'] };
  if (input.accessState === 'unavailable') return { decision: 'unavailable', reasonCodes: ['access_unavailable'] };
  if (input.chatType === 'channel' || input.chatType === 'contact' || input.chatType === 'bot') return { decision: 'rejected', reasonCodes: ['not_discussion_group'] };
  // Communities are not used: only their admins post to the announcement group.
  if (input.chatType === 'community') return { decision: 'rejected', reasonCodes: ['community_not_supported'] };
  const reasons: string[] = [];
  if (input.topicMatch === 'mismatch') reasons.push('topic_mismatch');
  if (input.canWrite === false) reasons.push('cannot_write');
  if (input.memberCount !== null && input.memberCount !== undefined && Number.isFinite(input.memberCount) && input.memberCount < minMembers) reasons.push('too_few_members');
  if (input.memberCount !== null && input.memberCount !== undefined && Number.isFinite(input.memberCount) && input.memberCount > maxMembers) reasons.push('too_many_members');
  if (reasons.length) return { decision: 'rejected', reasonCodes: reasons };

  // Target: a discussion group of 700–18,000 members with a Ukrainian audience where the account can write.
  // Ad rules and recent activity are not criteria (operator decision 2026-10-02).
  const required = [
    [input.chatType === 'group', 'unknown_chat_type'],
    [Number.isFinite(input.memberCount) && Number(input.memberCount) >= minMembers && Number(input.memberCount) <= maxMembers, 'unknown_member_count'],
    [input.topicMatch === 'match', 'unknown_topic_match'],
    [input.canWrite === true, 'unknown_can_write'],
    [input.membershipState === 'joined', 'unknown_membership'],
    [input.inspectionState === 'inspected', 'unknown_inspection'],
    // A candidate cannot become target until both the invite itself and post-join access are confirmed.
    [input.linkState === 'valid', 'unknown_invite_validity'],
    [input.accessState === 'available', 'unknown_access'],
  ] as const;
  for (const [ok, code] of required) if (!ok) reasons.push(code);
  return reasons.length ? { decision: 'review', reasonCodes: reasons } : { decision: 'target', reasonCodes: ['all_required_confirmed'] };
}

// Group names that are never targets even with a Ukrainian audience: religious communities and prayer groups.
export const NON_TARGET_GROUP_PATTERN = /(?:церк|церков|храм|парафі|приход|монастир|монастыр|православн|католиц|греко-?католи|біблі|библи|молит(?:в|ов)|богослуж|єпарх|епарх|проповід|пропове|church|parish|bible|prayer|monaster|orthodox|catholic)/iu;

export function inferDiscoveryTopicMatch(name: string, sources: DiscoverySource[]): DiscoveryCandidate['topicMatch'] {
  const raw = [name, ...sources.map((source) => source.context)].join(' ');
  const text = normalizeText(raw);
  if (/(shooting|casting|кастинг|масовк|vfs\s*slots?|visa\s*slots?|passport\s*appointment|driving\s*licen[cs]e\s*appointment)/u.test(text)) return 'mismatch';
  if (NON_TARGET_GROUP_PATTERN.test(raw)) return 'mismatch';
  const ukrainian = /(україн|украин|ukrain|🇺🇦)/u.test(raw.toLocaleLowerCase('uk-UA'));
  if (!ukrainian) return 'unknown';
  const relevant = /(барахол|куплю|продам|продаж|market|оголош|объявлен|дошка|доска|мам|батьк|parent|family|community|спільнот|авто|оренд|rent|житл|перевез|допомог|help|україн|украин)/u;
  return relevant.test(text) ? 'match' : 'unknown';
}

async function findExistingChat(db: D1Database, userId: string, platform: string, canonicalLink: string) {
  const normalized = await db.prepare(`SELECT id,platform,link,normalized_link,workflow_status FROM chats
    WHERE user_id=?1 AND platform=?2 AND normalized_link=?3 LIMIT 1`)
    .bind(userId, platform, canonicalLink).first<ExistingChat>();
  if (normalized) return normalized;
  return db.prepare(`SELECT id,platform,link,normalized_link,workflow_status FROM chats
    WHERE user_id=?1 AND platform=?2 AND link=?3 LIMIT 1`)
    .bind(userId, platform, canonicalLink).first<ExistingChat>();
}

async function readSources(db: D1Database, userId: string, candidateIds: string[]) {
  const map = new Map<string, DiscoverySource[]>();
  if (!candidateIds.length) return map;
  const result = await db.prepare(`SELECT candidate_id,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context
    FROM chat_discovery_sources WHERE user_id=?1 AND candidate_id IN (SELECT value FROM json_each(?2))
    ORDER BY discovered_at DESC,id LIMIT 800`).bind(userId, JSON.stringify(candidateIds)).all<SourceRow>();
  for (const row of result.results) {
    const list = map.get(row.candidate_id) || [];
    if (list.length < 8) list.push({
      kind: row.source_kind,
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      query: row.query_text,
      seedLabel: row.seed_label,
      seedKind: row.seed_kind,
      context: row.context,
    });
    map.set(row.candidate_id, list);
  }
  return map;
}

async function latestRun(db: D1Database, userId: string) {
  return db.prepare(`SELECT * FROM chat_discovery_runs WHERE user_id=?1
    ORDER BY updated_at DESC,id DESC LIMIT 1`).bind(userId).first<RunRow>();
}

async function readRun(db: D1Database, userId: string, runId: string) {
  return db.prepare(`SELECT * FROM chat_discovery_runs WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(runId, userId).first<RunRow>();
}

function mapRun(row: RunRow): DiscoveryRun {
  return {
    id: row.id,
    status: row.status,
    platforms: parsePlatforms(row.platforms_json),
    goal: row.goal,
    minMembers: row.min_members,
    cursor: row.source_cursor,
    telegramCursor: row.telegram_cursor,
    searchedQueries: row.searched_queries,
    foundCount: row.found_count,
    duplicateCount: row.duplicate_count,
    importedCount: row.imported_count,
    targetCount: Number(row.target_count || 0),
    completionReason: row.completion_reason === 'goal_reached' || row.completion_reason === 'sources_exhausted' ? row.completion_reason : null,
    errorMessage: row.error_message || '',
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    version: row.version,
  };
}

function mapCandidate(row: CandidateRow, sources: DiscoverySource[]): DiscoveryCandidate {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    link: row.normalized_link,
    discoveredAt: row.discovered_at,
    checkedAt: row.checked_at,
    memberCount: row.member_count,
    chatType: row.chat_type,
    activityState: row.activity_state,
    topicMatch: row.topic_match,
    canWrite: row.can_write === null ? null : Boolean(row.can_write),
    adsPolicy: row.ads_policy,
    membershipState: row.membership_state,
    accessState: row.access_state,
    linkState: row.link_state,
    inspectionState: row.inspection_state,
    decision: row.decision,
    reasonCodes: safeReasons(row.reason_codes_json),
    importedChatId: row.imported_chat_id,
    updatedAt: row.updated_at,
    version: row.version,
    sources,
  };
}

function validatePlatforms(value: unknown): DiscoveryPlatform[] {
  if (!Array.isArray(value)) throw new DiscoveryError('Оберіть WhatsApp або Viber для пошуку.');
  const platforms = [...new Set(value)].filter((item): item is DiscoveryPlatform => item === 'whatsapp' || item === 'viber');
  if (!platforms.length) throw new DiscoveryError('Оберіть WhatsApp або Viber для пошуку.');
  return platforms;
}

function parsePlatforms(value: string): DiscoveryPlatform[] {
  try { return validatePlatforms(JSON.parse(value)); }
  catch { return ['whatsapp']; }
}

function safeReasons(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  } catch { return []; }
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase('uk-UA').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
