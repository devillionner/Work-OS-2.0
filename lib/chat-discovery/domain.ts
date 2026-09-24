import { businessDate } from '../business-time.ts';
import { cleanChatName, normalizeGroupLink, suggestedChatName, type ChatPlatform } from '../chats/bulk-input.ts';
import { buildPublicSearchTasks, buildTelegramSearchPlan, discoverPublicWeb, discoverTelegramPublic, extractInviteRecords, type DiscoveryPlatform, type DiscoveryRecord, type DiscoverySource, type TelegramSearchPlan } from './public-web.ts';

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

export async function startDiscoveryRun(
  db: D1Database,
  userId: string,
  input: { platforms: unknown; goal?: unknown; minMembers?: unknown },
  now: number,
): Promise<DiscoveryRun> {
  const platforms = validatePlatforms(input.platforms);
  const goal = boundedInteger(input.goal, 1, 100, 50);
  const minMembers = boundedInteger(input.minMembers, 700, 18_000, 700);
  const existing = await activeRun(db, userId);
  if (existing) return mapRun(existing);
  const previous = await latestRun(db, userId);
  const previousTelegramCursor = Math.max(0, Number(previous?.telegram_cursor || 0));
  const telegramCursor = buildTelegramSearchPlan(previousTelegramCursor, 1).done ? 0 : previousTelegramCursor;
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO chat_discovery_runs
      (id,user_id,status,platforms_json,goal,min_members,source_cursor,telegram_cursor,searched_queries,found_count,duplicate_count,
       imported_count,error_message,started_at,updated_at,completed_at,version)
      VALUES (?1,?2,'running',?3,?4,?5,0,?6,0,0,0,0,NULL,?7,?7,NULL,1)`)
      .bind(id, userId, JSON.stringify(platforms), goal, minMembers, telegramCursor, now).run();
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
    SET status='cancelled',completed_at=?1,updated_at=?1,source_lease_device_id=NULL,source_lease_expires_at=NULL,version=version+1
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
  const reconciled = await reconcileDiscoveryRunGoal(db, userId, runId, now);
  return { run: reconciled, batch: { searched: web.searched, added: merged.added, duplicates: merged.duplicates, errors: web.errors } };
}

export async function advanceAutonomousDiscoveryRun(
  db: D1Database,
  userId: string,
  deviceId: string,
  now: number,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ advanced: boolean; source: 'telegram' | 'public_web' | 'idle' | 'busy'; run: DiscoveryRun | null; batch: { searched: number; added: number; duplicates: number; errors: number } }> {
  const active = await activeRun(db, userId);
  if (!active) {
    const latest = await latestRun(db, userId);
    return { advanced:false, source:'idle', run:latest ? mapRun(latest) : null, batch:{searched:0,added:0,duplicates:0,errors:0} };
  }
  const before = await reconcileDiscoveryRunGoal(db, userId, active.id, now);
  if (before.status !== 'running') {
    return { advanced:false, source:'idle', run:before, batch:{searched:0,added:0,duplicates:0,errors:0} };
  }
  const row = await readRun(db, userId, active.id);
  if (!row) throw new DiscoveryError('Запуск пошуку не знайдено.', 404);
  const leaseExpiresAt = now + 120;
  const claimed = await db.prepare(`UPDATE chat_discovery_runs
    SET source_lease_device_id=?1,source_lease_expires_at=?2,version=version+1
    WHERE id=?3 AND user_id=?4 AND status='running' AND version=?5
      AND (source_lease_device_id=?1 OR source_lease_expires_at IS NULL OR source_lease_expires_at<=?6)
    RETURNING *`).bind(deviceId, leaseExpiresAt, row.id, userId, row.version, now).first<RunRow>();
  if (!claimed) {
    const current = await readRun(db, userId, row.id);
    return { advanced:false, source:'busy', run:current ? mapRun(current) : before, batch:{searched:0,added:0,duplicates:0,errors:0} };
  }

  const telegramPlan = buildTelegramSearchPlan(claimed.telegram_cursor, 1);
  if (!telegramPlan.done) {
    const found = await discoverTelegramPublic({ cursor:claimed.telegram_cursor, maxQueries:2, pageLimit:3 }, fetcher);
    const merged = await persistDiscoveryBatch(db, userId, claimed, found.records, {
      now,
      nextCursor: claimed.source_cursor,
      searched: 0,
      done: false,
      errors: found.errors,
      completeAtGoal: false,
    });
    const advanced = await db.prepare(`UPDATE chat_discovery_runs SET
      telegram_cursor=?1,searched_queries=searched_queries+?2,
      error_message=?3,source_lease_device_id=NULL,source_lease_expires_at=?4,updated_at=?5,version=version+1
      WHERE id=?6 AND user_id=?7 AND status='running' AND source_lease_device_id=?8 RETURNING id`)
      .bind(found.nextCursor, found.searched, found.errors ? `Telegram/public search: ${found.errors} джерел не прочитано; пошук продовжиться.` : null,
        now + 15, now, claimed.id, userId, deviceId).first<{id:string}>();
    if (!advanced) throw new DiscoveryError('Автопошук уже змінився в іншому executor. Оновіть стан.', 409);
    const run = await reconcileDiscoveryRunGoal(db, userId, claimed.id, now);
    return { advanced:true, source:'telegram', run, batch:{searched:found.searched,added:merged.added,duplicates:merged.duplicates,errors:found.errors} };
  }

  const platforms = parsePlatforms(claimed.platforms_json);
  const publicTotal = buildPublicSearchTasks(platforms).length;
  if (claimed.source_cursor < publicTotal) {
    const web = await discoverPublicWeb({
      platforms,
      cursor: claimed.source_cursor,
      maxQueries: 4,
      pageLimit: 1,
      includeCurated: claimed.source_cursor === 0,
    }, fetcher);
    const merged = await persistDiscoveryBatch(db, userId, claimed, web.records, {
      now,
      nextCursor: web.nextCursor,
      searched: web.searched,
      done: web.done,
      errors: web.errors,
    });
    await db.prepare(`UPDATE chat_discovery_runs SET source_lease_device_id=NULL,source_lease_expires_at=?4
      WHERE id=?1 AND user_id=?2 AND source_lease_device_id=?3`).bind(claimed.id, userId, deviceId, now + 15).run();
    const run = await reconcileDiscoveryRunGoal(db, userId, claimed.id, now);
    return { advanced:true, source:'public_web', run, batch:{searched:web.searched,added:merged.added,duplicates:merged.duplicates,errors:web.errors} };
  }

  await db.prepare(`UPDATE chat_discovery_runs SET source_lease_device_id=NULL,source_lease_expires_at=NULL
    WHERE id=?1 AND user_id=?2 AND source_lease_device_id=?3`).bind(claimed.id, userId, deviceId).run();
  const run = await reconcileDiscoveryRunGoal(db, userId, claimed.id, now);
  return { advanced:false, source:'idle', run, batch:{searched:0,added:0,duplicates:0,errors:0} };
}

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

export async function ingestTelegramDiscovery(
  db: D1Database,
  userId: string,
  runId: string,
  input: {
    text: unknown;
    sourceUrl?: unknown;
    sourceTitle?: unknown;
    query?: unknown;
    seedLabel?: unknown;
    context?: unknown;
    completeQuery?: unknown;
  },
  now: number,
): Promise<{ run: DiscoveryRun; queryCompleted: boolean; batch: { extracted: number; added: number; duplicates: number } }> {
  const row = await readRun(db, userId, runId);
  if (!row) throw new DiscoveryError('Запуск пошуку не знайдено.', 404);
  if (row.status !== 'running') throw new DiscoveryError('Цей запуск пошуку вже завершено. Почніть новий.', 409);

  const text = boundedDiscoveryText(input.text, 48_000);
  if (!text) throw new DiscoveryError('Telegram-скан порожній.');
  const sourceUrl = boundedDiscoveryText(input.sourceUrl, 1000);
  const sourceTitle = boundedDiscoveryText(input.sourceTitle, 180);
  const query = boundedDiscoveryText(input.query, 500);
  const expectedQuery = buildTelegramSearchPlan(row.telegram_cursor, 1).tasks[0]?.query || '';
  if (!query || query !== expectedQuery) {
    throw new DiscoveryError('Telegram-результати мають відповідати поточному запиту плану.', 409);
  }
  const normalizedText = text.replaceAll('\\/', '/');
  const containsInvite = /(?:https?:\/\/)?chat\.whatsapp\.com\//iu.test(normalizedText);
  if (containsInvite && (!sourceTitle || !isTelegramSourceUrl(sourceUrl))) {
    throw new DiscoveryError('Для Telegram-скану з WhatsApp invite потрібні назва чату та коректне посилання на Telegram-джерело.');
  }
  const seedLabel = boundedDiscoveryText(input.seedLabel, 180) || sourceTitle || query;
  const context = boundedDiscoveryText(input.context, 700);
  const records = containsInvite ? extractInviteRecords(normalizedText, ['whatsapp'], {
    kind: 'telegram_global',
    sourceUrl,
    sourceTitle,
    query,
    seedLabel,
    seedKind: 'telegram_chat',
    context,
  }) : [];
  const merged = records.length
    ? await persistDiscoveryBatch(db, userId, row, records, {
      now,
      nextCursor: row.source_cursor,
      searched: 0,
      done: false,
      errors: 0,
      completeAtGoal: false,
    })
    : { run: mapRun(row), added: 0, duplicates: 0 };

  const completeQuery = input.completeQuery === true;
  if (!completeQuery) {
    return {
      run: merged.run,
      queryCompleted: false,
      batch: { extracted: records.length, added: merged.added, duplicates: merged.duplicates },
    };
  }

  const currentPlan = buildTelegramSearchPlan(row.telegram_cursor, 1);
  const advanced = await db.prepare(`UPDATE chat_discovery_runs
    SET telegram_cursor=?1,searched_queries=searched_queries+1,updated_at=?2,version=version+1
    WHERE id=?3 AND user_id=?4 AND status='running' AND version=?5 RETURNING id`)
    .bind(currentPlan.nextCursor, now, runId, userId, merged.run.version)
    .first<{ id: string }>();
  if (!advanced) throw new DiscoveryError('Telegram-план уже змінився в іншій вкладці. Оновіть стан.', 409);
  const fresh = await readRun(db, userId, runId);
  if (!fresh) throw new DiscoveryError('Не вдалося прочитати оновлений Telegram-план.', 500);
  const reconciled = await reconcileDiscoveryRunGoal(db, userId, runId, now);
  return {
    run: reconciled,
    queryCompleted: true,
    batch: { extracted: records.length, added: merged.added, duplicates: merged.duplicates },
  };
}

export async function readTelegramDiscoveryPlan(
  db: D1Database,
  userId: string,
  runId: string,
  limit = 6,
): Promise<{ run: DiscoveryRun; plan: TelegramSearchPlan }> {
  const row = await readRun(db, userId, runId);
  if (!row) throw new DiscoveryError('Запуск пошуку не знайдено.', 404);
  return { run: mapRun(row), plan: buildTelegramSearchPlan(row.telegram_cursor, boundedInteger(limit, 1, 20, 6)) };
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
  const reasons: string[] = [];
  if (input.topicMatch === 'mismatch') reasons.push('topic_mismatch');
  if (input.canWrite === false) reasons.push('cannot_write');
  if (input.adsPolicy === 'forbidden') reasons.push('ads_forbidden');
  if (input.memberCount !== null && input.memberCount !== undefined && Number.isFinite(input.memberCount) && input.memberCount < minMembers) reasons.push('too_few_members');
  if (input.memberCount !== null && input.memberCount !== undefined && Number.isFinite(input.memberCount) && input.memberCount > maxMembers) reasons.push('too_many_members');
  if (input.activityState === 'dead') reasons.push('inactive_chat');
  if (reasons.length) return { decision: 'rejected', reasonCodes: reasons };

  const required = [
    [['group', 'community'].includes(input.chatType || 'unknown'), 'unknown_chat_type'],
    [Number.isFinite(input.memberCount) && Number(input.memberCount) >= minMembers && Number(input.memberCount) <= maxMembers, 'unknown_member_count'],
    [input.topicMatch === 'match', 'unknown_topic_match'],
    [input.canWrite === true, 'unknown_can_write'],
    [['allowed', 'operator_confirmed', 'inferred_allowed'].includes(input.adsPolicy || 'unknown'), 'unknown_ads_allowed'],
    [input.activityState === 'active', 'unknown_activity'],
    [input.membershipState === 'joined', 'unknown_membership'],
    [input.inspectionState === 'inspected', 'unknown_inspection'],
    // A candidate cannot become target until both the invite itself and post-join access are confirmed.
    [input.linkState === 'valid', 'unknown_invite_validity'],
    [input.accessState === 'available', 'unknown_access'],
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
  progress: { now: number; nextCursor: number; searched: number; done: boolean; errors: number; completeAtGoal?: boolean },
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
  const autoHandoffIds: string[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const item of canonical.values()) {
    if (existingChats.has(`${item.platform}|${item.link}`)) {
      duplicates += 1;
      continue;
    }
    const existing = existingCandidates.get(`${item.platform}|${item.link}`);
    const candidateId = existing?.id || await stableId('candidate', `${userId}:${item.platform}:${item.link}`);
    const name = item.name || suggestedChatName(normalizeGroupLink(item.link)!);
    const topicMatch = existing?.topic_match && existing.topic_match !== 'unknown'
      ? existing.topic_match
      : inferDiscoveryTopicMatch(name, item.sources);
    const evaluated = evaluateDiscoveryCandidate({
      chatType: existing?.chat_type || 'unknown',
      memberCount: existing?.member_count ?? null,
      topicMatch,
      canWrite: existing?.can_write === null || existing?.can_write === undefined ? null : Boolean(existing.can_write),
      adsPolicy: existing?.ads_policy || 'unknown',
      activityState: existing?.activity_state || 'unknown',
      membershipState: existing?.membership_state || 'not_checked',
      inspectionState: existing?.inspection_state || 'not_checked',
      accessState: existing?.access_state || 'unknown',
      linkState: existing?.link_state || 'valid',
    }, run.min_members);

    if (existing) duplicates += 1;
    else {
      added += 1;
      if (item.platform === 'whatsapp') autoHandoffIds.push(candidateId);
    }
    statements.push(db.prepare(`INSERT INTO chat_discovery_candidates
      (id,user_id,platform,name,link,normalized_link,discovered_at,checked_at,member_count,chat_type,activity_state,topic_match,
       can_write,ads_policy,membership_state,access_state,link_state,inspection_state,decision,reason_codes_json,
       imported_chat_id,discovery_run_id,created_at,updated_at,version)
      SELECT ?1,?2,?3,?4,?5,?5,?6,NULL,NULL,'unknown','unknown',?7,NULL,'unknown','not_checked','unknown','valid',
        'not_checked',?8,?9,NULL,?10,?6,?6,1
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

  const errorMessage = progress.errors ? `Не вдалося прочитати ${progress.errors} джерел; пошук можна продовжити.` : null;
  const nextSourceCursor = progress.completeAtGoal === false ? run.source_cursor : progress.nextCursor;
  statements.push(db.prepare(`UPDATE chat_discovery_runs SET
    source_cursor=?1,searched_queries=searched_queries+?2,found_count=found_count+?3,
    duplicate_count=duplicate_count+?4,error_message=?5,updated_at=?6,version=version+1
    WHERE id=?7 AND user_id=?8 AND status='running' AND version=?9 RETURNING id`)
    .bind(nextSourceCursor, progress.searched, added, duplicates,
      errorMessage, progress.now, run.id, userId, run.version));

  const results = await db.batch(statements);
  const final = results.at(-1);
  if (!final?.results.length) throw new DiscoveryError('Пошук уже продовжили в іншій вкладці. Оновіть стан.', 409);
  for (const candidateId of autoHandoffIds) {
    const candidate = await db.prepare(`SELECT version,imported_chat_id,decision FROM chat_discovery_candidates
      WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(candidateId, userId)
      .first<{version:number;imported_chat_id:string|null;decision:DiscoveryDecision}>();
    if (!candidate || candidate.imported_chat_id || !['review','target'].includes(candidate.decision)) continue;
    try {
      await handoffDiscoveryCandidate(db, userId, candidateId, candidate.version, progress.now);
    } catch (error) {
      if (!(error instanceof DiscoveryError) || ![409,404].includes(error.status)) throw error;
    }
  }

  const updated = await reconcileDiscoveryRunGoal(db, userId, run.id, progress.now);
  return { run: updated, added, duplicates };
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

function boundedDiscoveryText(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function isTelegramSourceUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 't.me' || host === 'telegram.me' || host === 'web.telegram.org');
  } catch {
    return false;
  }
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
