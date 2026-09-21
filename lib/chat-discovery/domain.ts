import { businessDate } from '../business-time.ts';
import { cleanChatName, normalizeGroupLink, suggestedChatName, type ChatPlatform } from '../chats/bulk-input.ts';
import { discoverPublicWeb, type DiscoveryPlatform, type DiscoveryRecord, type DiscoverySource } from './public-web.ts';

export type DiscoveryDecision = 'review' | 'target' | 'rejected' | 'unavailable';
export type DiscoveryRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type DiscoveryRun = {
  id: string;
  status: DiscoveryRunStatus;
  platforms: DiscoveryPlatform[];
  goal: number;
  minMembers: number;
  cursor: number;
  searchedQueries: number;
  foundCount: number;
  duplicateCount: number;
  importedCount: number;
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
  source_cursor: number; searched_queries: number; found_count: number; duplicate_count: number;
  imported_count: number; error_message: string | null; started_at: number; updated_at: number;
  completed_at: number | null; version: number;
};
type CandidateRow = {
  id: string; platform: ChatPlatform; name: string; link: string; normalized_link: string;
  discovered_at: number; checked_at: number | null; member_count: number | null;
  chat_type: DiscoveryCandidate['chatType']; activity_state: DiscoveryCandidate['activityState'];
  topic_match: DiscoveryCandidate['topicMatch']; can_write: number | null;
  ads_policy: DiscoveryCandidate['adsPolicy']; membership_state: DiscoveryCandidate['membershipState'];
  access_state: DiscoveryCandidate['accessState']; link_state: DiscoveryCandidate['linkState'];
  inspection_state: DiscoveryCandidate['inspectionState']; decision: DiscoveryDecision;
  reason_codes_json: string; imported_chat_id: string | null; updated_at: number; version: number;
};
type SourceRow = {
  candidate_id: string; source_kind: DiscoverySource['kind']; source_url: string; source_title: string;
  query_text: string; seed_label: string; seed_kind: string; context: string;
};
type ExistingChat = { id: string; platform: string; link: string; normalized_link: string; workflow_status: string };

export async function startDiscoveryRun(
  db: D1Database,
  userId: string,
  input: { platforms: unknown; goal?: unknown; minMembers?: unknown },
  now: number,
): Promise<DiscoveryRun> {
  const platforms = validatePlatforms(input.platforms);
  const goal = boundedInteger(input.goal, 1, 100, 30);
  const minMembers = boundedInteger(input.minMembers, 1, 10_000_000, 700);
  const existing = await activeRun(db, userId);
  if (existing) return mapRun(existing);
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO chat_discovery_runs
      (id,user_id,status,platforms_json,goal,min_members,source_cursor,searched_queries,found_count,duplicate_count,
       imported_count,error_message,started_at,updated_at,completed_at,version)
      VALUES (?1,?2,'running',?3,?4,?5,0,0,0,0,0,NULL,?6,?6,NULL,1)`)
      .bind(id, userId, JSON.stringify(platforms), goal, minMembers, now).run();
  } catch {
    const concurrent = await activeRun(db, userId);
    if (concurrent) return mapRun(concurrent);
    throw new DiscoveryError('Не вдалося запустити пошук чатів. Спробуйте ще раз.', 500);
  }
  const row = await readRun(db, userId, id);
  if (!row) throw new DiscoveryError('Не вдалося створити запуск пошуку.', 500);
  return mapRun(row);
}

export async function cancelDiscoveryRun(db: D1Database, userId: string, runId: string, expectedVersion: number, now: number) {
  const result = await db.prepare(`UPDATE chat_discovery_runs
    SET status='cancelled',completed_at=?1,updated_at=?1,version=version+1
    WHERE id=?2 AND user_id=?3 AND status='running' AND version=?4 RETURNING id`)
    .bind(now, runId, userId, expectedVersion).all<{ id: string }>();
  if (!result.results.length) throw new DiscoveryError('Пошук уже змінився в іншій вкладці. Оновіть стан.', 409);
  return { cancelled: true };
}

export async function continueDiscoveryRun(
  db: D1Database,
  userId: string,
  runId: string,
  now: number,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ run: DiscoveryRun; batch: { searched: number; added: number; duplicates: number; errors: number } }> {
  const row = await readRun(db, userId, runId);
  if (!row) throw new DiscoveryError('Запуск пошуку не знайдено.', 404);
  if (row.status !== 'running') return { run: mapRun(row), batch: { searched: 0, added: 0, duplicates: 0, errors: 0 } };

  const platforms = parsePlatforms(row.platforms_json);
  const web = await discoverPublicWeb({
    platforms,
    cursor: row.source_cursor,
    maxQueries: 6,
    pageLimit: 1,
    includeCurated: row.source_cursor === 0,
  }, fetcher);

  const merged = await persistDiscoveryBatch(db, userId, row, web.records, {
    now,
    nextCursor: web.nextCursor,
    searched: web.searched,
    done: web.done,
    errors: web.errors,
  });
  return { run: merged.run, batch: { searched: web.searched, added: merged.added, duplicates: merged.duplicates, errors: web.errors } };
}

export async function readDiscoveryWorkspace(
  db: D1Database,
  userId: string,
  input: { decision?: string | null; limit?: number } = {},
): Promise<{ run: DiscoveryRun | null; counts: Record<DiscoveryDecision, number>; importedCount: number; candidates: DiscoveryCandidate[] }> {
  const decision = ['review', 'target', 'rejected', 'unavailable'].includes(input.decision || '') ? input.decision! : null;
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 60));
  const [run, countsResult, importedResult, candidateResult] = await Promise.all([
    latestRun(db, userId),
    db.prepare(`SELECT decision,COUNT(*) AS count FROM chat_discovery_candidates WHERE user_id=?1 GROUP BY decision`).bind(userId).all<{ decision: DiscoveryDecision; count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM chat_discovery_candidates WHERE user_id=?1 AND imported_chat_id IS NOT NULL`).bind(userId).first<{ count: number }>(),
    decision
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
    counts,
    importedCount: Number(importedResult?.count || 0),
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

export function evaluateDiscoveryCandidate(input: {
  chatType?: DiscoveryCandidate['chatType'];
  memberCount?: number | null;
  topicMatch?: DiscoveryCandidate['topicMatch'];
  canWrite?: boolean | null;
  adsPolicy?: DiscoveryCandidate['adsPolicy'];
  activityState?: DiscoveryCandidate['activityState'];
  accessState?: DiscoveryCandidate['accessState'];
  linkState?: DiscoveryCandidate['linkState'];
}, minMembers = 700): { decision: DiscoveryDecision; reasonCodes: string[] } {
  if (input.accessState === 'unavailable' || input.linkState === 'invalid') return { decision: 'unavailable', reasonCodes: ['access_unavailable'] };
  if (input.chatType === 'channel' || input.chatType === 'contact' || input.chatType === 'bot') return { decision: 'rejected', reasonCodes: ['not_discussion_group'] };
  const reasons: string[] = [];
  if (input.topicMatch === 'mismatch') reasons.push('topic_mismatch');
  if (input.canWrite === false) reasons.push('cannot_write');
  if (input.adsPolicy === 'forbidden') reasons.push('ads_forbidden');
  if (input.memberCount !== null && input.memberCount !== undefined && Number.isFinite(input.memberCount) && input.memberCount < minMembers) reasons.push('too_few_members');
  if (input.activityState === 'dead') reasons.push('inactive_chat');
  if (reasons.length) return { decision: 'rejected', reasonCodes: reasons };

  const required = [
    [['group', 'community'].includes(input.chatType || 'unknown'), 'unknown_chat_type'],
    [Number.isFinite(input.memberCount) && Number(input.memberCount) >= minMembers, 'unknown_member_count'],
    [input.topicMatch === 'match', 'unknown_topic_match'],
    [input.canWrite === true, 'unknown_can_write'],
    [['allowed', 'inferred_allowed', 'operator_confirmed'].includes(input.adsPolicy || 'unknown'), 'unknown_ads_allowed'],
    [input.activityState === 'active', 'unknown_activity'],
  ] as const;
  for (const [ok, code] of required) if (!ok) reasons.push(code);
  return reasons.length ? { decision: 'review', reasonCodes: reasons } : { decision: 'target', reasonCodes: ['all_required_confirmed'] };
}

export function inferDiscoveryTopicMatch(name: string, sources: DiscoverySource[]): DiscoveryCandidate['topicMatch'] {
  const raw = [name, ...sources.map((source) => source.context)].join(' ');
  const text = normalizeText(raw);
  if (/(shooting|casting|кастинг|масовк|vfs\s*slots?|visa\s*slots?|passport\s*appointment|driving\s*licen[cs]e\s*appointment)/u.test(text)) return 'mismatch';
  const ukrainian = /(україн|украин|ukrain|🇺🇦)/u.test(raw.toLocaleLowerCase('uk-UA'));
  if (!ukrainian) return 'unknown';
  const relevant = /(барахол|куплю|продам|продаж|market|оголош|объявлен|дошка|доска|мам|батьк|parent|family|community|спільнот|авто|оренд|rent|житл|перевез|допомог|help|україн|украин)/u;
  return relevant.test(text) ? 'match' : 'unknown';
}

async function persistDiscoveryBatch(
  db: D1Database,
  userId: string,
  run: RunRow,
  records: DiscoveryRecord[],
  progress: { now: number; nextCursor: number; searched: number; done: boolean; errors: number },
): Promise<{ run: DiscoveryRun; added: number; duplicates: number }> {
  const canonical = new Map<string, { platform: DiscoveryPlatform; link: string; name: string; sources: DiscoverySource[] }>();
  for (const record of records) {
    const parsed = normalizeGroupLink(record.link);
    if (!parsed || (parsed.platform !== 'whatsapp' && parsed.platform !== 'viber')) continue;
    const key = `${parsed.platform}|${parsed.link}`;
    const item = canonical.get(key) || { platform: parsed.platform, link: parsed.link, name: '', sources: [] };
    const hint = cleanChatName(record.nameHint || '');
    if (!item.name && hint) item.name = hint;
    const sourceKey = sourceIdentity(record.source);
    if (!item.sources.some((source) => sourceIdentity(source) === sourceKey)) item.sources.push(record.source);
    canonical.set(key, item);
  }

  const platforms = parsePlatforms(run.platforms_json);
  const existingChats = await readExistingCanonicalLinks(db, userId, platforms);
  const existingCandidates = await readExistingCandidates(db, userId, [...canonical.values()].map((item) => item.link));
  let duplicates = 0;
  let added = 0;
  const statements: D1PreparedStatement[] = [];

  for (const item of canonical.values()) {
    if (existingChats.has(`${item.platform}|${item.link}`)) {
      duplicates += 1;
      continue;
    }
    const existing = existingCandidates.get(`${item.platform}|${item.link}`);
    const candidateId = existing?.id || await stableId('candidate', `${userId}:${item.platform}:${item.link}`);
    const name = item.name || suggestedChatName(normalizeGroupLink(item.link)!);
    const topicMatch = existing?.topic_match === 'unknown' || !existing ? inferDiscoveryTopicMatch(name, item.sources) : existing.topic_match;
    const evaluated = evaluateDiscoveryCandidate({
      chatType: existing?.chat_type || 'unknown',
      memberCount: existing?.member_count ?? null,
      topicMatch,
      canWrite: existing?.can_write === null || existing?.can_write === undefined ? null : Boolean(existing.can_write),
      adsPolicy: existing?.ads_policy || 'unknown',
      activityState: existing?.activity_state || 'unknown',
      accessState: existing?.access_state || 'unknown',
      linkState: existing?.link_state || 'valid',
    }, run.min_members);

    if (existing) duplicates += 1;
    else added += 1;
    statements.push(db.prepare(`INSERT INTO chat_discovery_candidates
      (id,user_id,platform,name,link,normalized_link,discovered_at,checked_at,member_count,chat_type,activity_state,topic_match,
       can_write,ads_policy,membership_state,access_state,link_state,inspection_state,decision,reason_codes_json,
       imported_chat_id,created_at,updated_at,version)
      SELECT ?1,?2,?3,?4,?5,?5,?6,NULL,NULL,'unknown','unknown',?7,NULL,'unknown','not_checked','unknown','valid',
        'not_checked',?8,?9,NULL,?6,?6,1
      WHERE EXISTS(SELECT 1 FROM chat_discovery_runs WHERE id=?10 AND user_id=?2 AND status='running' AND version=?11)
      ON CONFLICT(user_id,platform,normalized_link) DO UPDATE SET
        name=CASE WHEN chat_discovery_candidates.name='' OR chat_discovery_candidates.name LIKE 'WhatsApp · %'
          OR chat_discovery_candidates.name LIKE 'Viber · %' THEN excluded.name ELSE chat_discovery_candidates.name END,
        topic_match=CASE WHEN chat_discovery_candidates.topic_match='unknown' THEN excluded.topic_match ELSE chat_discovery_candidates.topic_match END,
        updated_at=excluded.updated_at,version=chat_discovery_candidates.version+1`)
      .bind(candidateId, userId, item.platform, name, item.link, progress.now, topicMatch,
        existing ? existing.decision : evaluated.decision, JSON.stringify(existing ? safeReasons(existing.reason_codes_json) : evaluated.reasonCodes),
        run.id, run.version));

    for (const source of item.sources.slice(0, 12)) {
      const sourceKey = await stableId('source', `${candidateId}:${sourceIdentity(source)}`);
      statements.push(db.prepare(`INSERT INTO chat_discovery_sources
        (id,candidate_id,user_id,source_key,source_kind,source_url,source_title,query_text,seed_label,seed_kind,context,discovered_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12
        WHERE EXISTS(SELECT 1 FROM chat_discovery_runs WHERE id=?13 AND user_id=?3 AND status='running' AND version=?14)
        ON CONFLICT(candidate_id,source_key) DO NOTHING`)
        .bind(sourceKey, candidateId, userId, sourceIdentity(source), source.kind, source.sourceUrl, source.sourceTitle,
          source.query, source.seedLabel, source.seedKind, source.context, progress.now, run.id, run.version));
    }
  }

  const projectedFound = run.found_count + added;
  const completed = progress.done || projectedFound >= run.goal;
  const errorMessage = progress.errors ? `Не вдалося прочитати ${progress.errors} джерел; пошук можна продовжити.` : null;
  statements.push(db.prepare(`UPDATE chat_discovery_runs SET
    status=?1,source_cursor=?2,searched_queries=searched_queries+?3,found_count=found_count+?4,
    duplicate_count=duplicate_count+?5,error_message=?6,updated_at=?7,completed_at=?8,version=version+1
    WHERE id=?9 AND user_id=?10 AND status='running' AND version=?11 RETURNING id`)
    .bind(completed ? 'completed' : 'running', progress.nextCursor, progress.searched, added, duplicates,
      errorMessage, progress.now, completed ? progress.now : null, run.id, userId, run.version));

  const results = await db.batch(statements);
  const final = results.at(-1);
  if (!final?.results.length) throw new DiscoveryError('Пошук уже продовжили в іншій вкладці. Оновіть стан.', 409);
  const updated = await readRun(db, userId, run.id);
  if (!updated) throw new DiscoveryError('Не вдалося прочитати оновлений запуск пошуку.', 500);
  return { run: mapRun(updated), added, duplicates };
}

async function readExistingCanonicalLinks(db: D1Database, userId: string, platforms: DiscoveryPlatform[]) {
  const result = await db.prepare(`SELECT id,platform,link,normalized_link,workflow_status FROM chats
    WHERE user_id=?1 AND platform IN (SELECT value FROM json_each(?2)) LIMIT 10001`)
    .bind(userId, JSON.stringify(platforms)).all<ExistingChat>();
  if (result.results.length > 10_000) throw new DiscoveryError('У базі понад 10 000 чатів на вибраних платформах. Спочатку перевірте дублікати.', 409);
  const keys = new Set<string>();
  for (const chat of result.results) {
    for (const value of [chat.link, chat.normalized_link]) {
      const parsed = normalizeGroupLink(value);
      if (parsed) keys.add(`${parsed.platform}|${parsed.link}`);
    }
  }
  return keys;
}

async function readExistingCandidates(db: D1Database, userId: string, links: string[]) {
  if (!links.length) return new Map<string, CandidateRow>();
  const result = await db.prepare(`SELECT * FROM chat_discovery_candidates
    WHERE user_id=?1 AND normalized_link IN (SELECT value FROM json_each(?2))`)
    .bind(userId, JSON.stringify([...new Set(links)])).all<CandidateRow>();
  return new Map(result.results.map((row) => [`${row.platform}|${row.normalized_link}`, row]));
}

async function findExistingChat(db: D1Database, userId: string, platform: string, canonicalLink: string) {
  const rows = await db.prepare(`SELECT id,platform,link,normalized_link,workflow_status FROM chats
    WHERE user_id=?1 AND platform=?2 LIMIT 10001`).bind(userId, platform).all<ExistingChat>();
  if (rows.results.length > 10_000) throw new DiscoveryError('На платформі понад 10 000 чатів. Потрібна перевірка дублікатів.', 409);
  return rows.results.find((row) => {
    const direct = normalizeGroupLink(row.link);
    const stored = normalizeGroupLink(row.normalized_link);
    return direct?.link === canonicalLink || stored?.link === canonicalLink;
  }) || null;
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

async function activeRun(db: D1Database, userId: string) {
  return db.prepare(`SELECT * FROM chat_discovery_runs WHERE user_id=?1 AND status='running'
    ORDER BY updated_at DESC LIMIT 1`).bind(userId).first<RunRow>();
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
    searchedQueries: row.searched_queries,
    foundCount: row.found_count,
    duplicateCount: row.duplicate_count,
    importedCount: row.imported_count,
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
  if (!Array.isArray(value) || !value.includes('whatsapp')) throw new DiscoveryError('Пошук зараз працює лише для WhatsApp.');
  return ['whatsapp'];
}

function parsePlatforms(value: string): DiscoveryPlatform[] {
  try { return validatePlatforms(JSON.parse(value)); }
  catch { return ['whatsapp']; }
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
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

function sourceIdentity(source: DiscoverySource) {
  return [source.kind, source.sourceUrl, source.query, source.seedLabel, source.context].join('|').slice(0, 3000);
}

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 32)}`;
}
