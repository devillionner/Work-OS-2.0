// State of the WhatsApp Discovery autonomous run ("автопошук"), owned by the owner Durable Object.
//
// Until 2026-10-04 this state lived in the Work OS tab's sessionStorage and the local runner rewrote it
// through CDP (JS strings inside scripts/whatsapp-web-cdp.mjs), so closing the tab stopped the run and no
// other device could see or start it. These are the same rules as pure functions, so the DO, the UI and
// the tests share one implementation. Nothing here touches D1: results stay unwritten until the operator
// presses «Підтвердити» / «Архівувати всі» (operator decision 2026-10-02).
import type { LocalDiscoveryPreview } from './local-preview.ts';
import { resetDiscoveryRetryCheckpoint } from './retry-state.ts';

export type RunDecision = 'review' | 'target' | 'rejected' | 'skipped' | 'unavailable';
export type RunCandidate = LocalDiscoveryPreview & {
  discoveryCheckpoint?: Record<string, unknown> | null;
  /** ms epoch: the runner released this candidate (local cooldown) — do not dispatch it before then. */
  skipUntil?: number;
};
export type RunIssue = { reason: string; query: string };
export type RunResultPayload = {
  decision: RunDecision;
  reasonCodes: string[];
  result: Record<string, unknown>;
  leftAfterCheck?: boolean;
  leaveReason?: string | null;
  completedAt: number;
  durationMs?: number;
  runId?: string;
};
export type RunPauseSummary = {
  at: number; cursor: number; targets: number; rejected: number; skipped: number;
  unavailable: number; unverified: number; archiveFailed: number;
};
export type DiscoveryRunState = {
  runId?: string;
  sourceTotal: number;
  sourceErrors: number;
  sourceFailures: number;
  sourceIssues: RunIssue[];
  telegramCursor: number;
  discoveryMetrics?: { completed: number; targets: number; totalCheckMs: number; reasons: Record<string, number> };
  searched: number;
  processed: number;
  duplicates: number;
  rejected: number;
  done: boolean;
  running: boolean;
  sourceExhausted: boolean;
  goal: number;
  lastActivityAt: number | null;
  completionReason: 'goal_reached' | 'sources_exhausted' | 'source_error' | null;
  candidates: RunCandidate[];
  confirmedThisRun?: number;
  activeCandidateId?: string | null;
  activeCandidateName?: string | null;
  activeCandidateLink?: string | null;
  activeCandidateStartedAt?: number | null;
  lastCheckedName?: string | null;
  lastCheckedDecision?: RunDecision | null;
  lastCheckedAt?: number | null;
  lastCheckedReasonCodes?: string[];
  pauseSummary?: RunPauseSummary | null;
};
export type SourceBatch = {
  nextCursor: number;
  searched: number;
  done: boolean;
  totalTasks: number;
  errors?: RunIssue[];
  warnings?: RunIssue[];
};
export type SourcePreviewOutcome =
  | { ok: true; sourceUrl: string; previews: LocalDiscoveryPreview[]; added: number; duplicates: number; extracted?: number }
  | { ok: false; sourceUrl: string; query: string; reason: string };
export type SourceFeedbackEntry = {
  score: number; lastCrawledAt: number; lastOutcomeAt: number; added: number; duplicates: number;
  targets: number; saturatedUntil: number;
};
export type SourceFeedback = Record<string, SourceFeedbackEntry>;
export type SourceFeedbackEvent = {
  sourceUrl: string; added?: number; duplicates?: number; decision?: string; reasonCodes?: string[];
  memberCount?: number | null; canWrite?: boolean | null;
};

export const FINISHED_STATES = new Set(['target', 'review', 'rejected', 'skipped', 'unavailable']);
export const NON_TARGET_STATES = new Set(['rejected', 'skipped', 'unavailable']);
/** Stop refilling from Telegram once this many candidates wait for a WhatsApp check. */
export const SOURCE_TARGET_QUEUE = 12;
const MAX_SOURCE_FAILURES = 2;

export const EMPTY_RUN: DiscoveryRunState = {
  sourceTotal: 0, sourceErrors: 0, sourceFailures: 0, sourceIssues: [], telegramCursor: 0,
  searched: 0, processed: 0, duplicates: 0, rejected: 0,
  done: false, running: false, sourceExhausted: false, goal: 50, lastActivityAt: null, completionReason: null, candidates: [],
};

const clearedActive = { activeCandidateId: null, activeCandidateName: null, activeCandidateLink: null, activeCandidateStartedAt: null };

export function clampGoal(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(100, Math.round(number))) : 50;
}

/** New run: finished, unconfirmed results are carried over so a new run never re-checks them. */
export function startRun(previous: DiscoveryRunState, input: { runId: string; goal: unknown; now: number }): DiscoveryRunState {
  return {
    ...EMPTY_RUN,
    runId: input.runId,
    running: true,
    goal: clampGoal(input.goal),
    candidates: previous.candidates.filter((candidate) => FINISHED_STATES.has(String(candidate.preflightState))),
    confirmedThisRun: 0,
    lastActivityAt: input.now,
  };
}

/** «Продовжити»: after a pause or a Telegram stop, resume from the same step and queue. */
export function resumeRun(state: DiscoveryRunState, now: number): DiscoveryRunState {
  return {
    ...state, ...clearedActive, running: true, done: false, sourceFailures: 0, sourceIssues: [],
    completionReason: null, pauseSummary: null, lastActivityAt: now,
  };
}

export function canResume(state: DiscoveryRunState) {
  return Boolean(state.runId) && !state.running && !state.done && (state.completionReason === 'source_error' || Boolean(state.pauseSummary));
}

export function pauseRun(state: DiscoveryRunState, now: number): DiscoveryRunState {
  const count = (decision: string) => state.candidates.filter((candidate) => candidate.preflightState === decision).length;
  return {
    ...state, ...clearedActive, running: false, sourceFailures: 0, sourceIssues: [], lastActivityAt: now,
    pauseSummary: {
      at: now, cursor: state.telegramCursor, targets: count('target'), rejected: count('rejected'),
      skipped: count('skipped'), unavailable: count('unavailable'), unverified: count('queued'), archiveFailed: 0,
    },
  };
}

/** Telegram refused to continue (rate limit, tab missing, logged out): stop on the same step. */
export function pauseOnSourceBlock(state: DiscoveryRunState, issue: RunIssue, now: number): DiscoveryRunState {
  if (!state.running) return state;
  return {
    ...state, ...clearedActive, running: false, completionReason: 'source_error',
    sourceIssues: [{ reason: issue.reason.slice(0, 120), query: issue.query.slice(0, 300) }], lastActivityAt: now,
  };
}

function hardNoise(candidate: { name?: unknown }) {
  const label = String(candidate?.name || '').trim().toLocaleLowerCase('uk-UA');
  const hasDigit = [...label].some((char) => char >= '0' && char <= '9');
  return ['tiktok', 'facebook', 'instagram'].includes(label)
    || label.includes('eventbrite')
    || label.includes('майстер-клас')
    || label.includes('майстер клас')
    || (label.includes('реєстрац') && hasDigit);
}

function rejectAsNoise<T extends RunCandidate>(candidate: T): T {
  return {
    ...candidate, decision: 'rejected', reasonCodes: ['source_event_specific'], preflightState: 'rejected',
    preflightReasonCodes: ['source_event_specific'], leftAfterCheck: false,
  };
}

function priority(candidate: RunCandidate) {
  const name = String(candidate?.name || '');
  const source = Array.isArray(candidate?.sources) ? candidate.sources[0] : null;
  const sourceTitle = String(source?.sourceTitle || '');
  const evidence = name + ' ' + sourceTitle;
  let score = 0;
  if (/(?:україн|украин|ukrain|🇺🇦)/iu.test(sourceTitle)) score += 12;
  if (/(?:україн|украин|ukrain|🇺🇦)/iu.test(name)) score += 8;
  if (/(?:впо|біжен|refuge|допомог|help|diaspora|community|громад)/iu.test(evidence)) score += 4;
  if (/(?:оголош|объявлен|куп(?:и|лю|ів)|прод(?:ай|ам|аж)|перевез|transport|батьк|родител|family|famil|(?:чат|chat)(?![\p{L}\p{N}_]))/iu.test(evidence)) score += 8;
  if (/(?:bremen|berlin|rotterdam|london|toronto|slovak|нідерланд|німеч|австр|куопіо|карінт|швельм)/iu.test(evidence)) score += 2;
  if (/(?:дитяч(?:ий|ого) табір|медичн(?:і|ые) питання|книжков(?:ий|ый) клуб|паспорт|document|документ|it\s*&\s*business|майстер-клас|майстер клас|(?:кафе|café)(?![\p{L}\p{N}_]))/iu.test(evidence)) score -= 8;
  if (/^(?:tiktok|facebook|instagram|whatsapp|telegram)$/iu.test(name.trim())) score -= 14;
  if (/(?:eventbrite|реєстрац|майстер-клас|майстер клас|\bviews?\b|ref=share|\/groups\/|<span|https?:\/\/|href=|style=)/iu.test(name)) score -= 10;
  if (name.length > 140) score -= 6;
  if (source?.kind === 'telegram_global' || source?.kind === 'telegram_scanned') score += 2;
  else if (source?.kind === 'curated') score += 1;
  return score;
}

function dispatchable(candidate: RunCandidate, state: DiscoveryRunState, now: number) {
  return candidate.preflightState === 'queued' && typeof candidate.link === 'string' && candidate.link
    && candidate.id !== state.activeCandidateId && !(Number(candidate.skipUntil) > now);
}

export function queuedCount(state: DiscoveryRunState, now: number) {
  return state.candidates.filter((candidate) => dispatchable(candidate, state, now)).length;
}

/** Earliest moment a locally cooled-down candidate becomes dispatchable again, or null. */
export function nextSkipExpiry(state: DiscoveryRunState, now: number): number | null {
  const times = state.candidates
    .filter((candidate) => candidate.preflightState === 'queued' && Number(candidate.skipUntil) > now)
    .map((candidate) => Number(candidate.skipUntil));
  return times.length ? Math.min(...times) : null;
}

export type RunTask = {
  candidateId: string; runId: string; membershipState: string; groupId?: string;
  checkpoint: Record<string, unknown> | null; sources: unknown[]; runtime: 'whatsapp_web'; platform: 'whatsapp';
  action: 'join_and_inspect'; name: string; link: string; topicMatch: string; minMembers: number;
  expectedTarget: { name: string; link: string };
};

export function candidateTask(candidate: RunCandidate, runId: string): RunTask {
  const link = String(candidate.link || '');
  return {
    candidateId: candidate.id,
    runId,
    membershipState: candidate.membershipState,
    groupId: candidate.groupId,
    checkpoint: candidate.discoveryCheckpoint || null,
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    runtime: 'whatsapp_web',
    platform: 'whatsapp',
    action: 'join_and_inspect',
    name: String(candidate.name || 'WhatsApp candidate'),
    link,
    topicMatch: candidate.topicMatch || 'unknown',
    minMembers: 700,
    expectedTarget: { name: 'WhatsApp · ' + (link.split('/').filter(Boolean).at(-1)?.split('?')[0] || ''), link },
  };
}

/** Highest-priority dispatchable candidate; obvious noise in the queue is rejected on the way. */
export function nextCandidateTask(state: DiscoveryRunState, now: number): { state: DiscoveryRunState; task: RunTask | null } {
  if (!state.running || !state.runId) return { state, task: null };
  let changed = false;
  const candidates = state.candidates.map((candidate) => {
    if (candidate.preflightState === 'queued' && hardNoise(candidate)) { changed = true; return rejectAsNoise(candidate); }
    return candidate;
  });
  const next = changed ? { ...state, candidates } : state;
  const candidate = next.candidates.filter((item) => dispatchable(item, next, now)).sort((a, b) => priority(b) - priority(a))[0];
  return { state: next, task: candidate ? candidateTask(candidate, next.runId as string) : null };
}

/** The runner reports the candidate it is working on (and its checkpoint, so a crash never repeats a join). */
export function markActive(
  state: DiscoveryRunState,
  input: { candidateId: string; runId?: string; name?: string; link?: string; checkpoint?: Record<string, unknown> | null },
  now: number,
): DiscoveryRunState | null {
  if (input.runId && input.runId !== state.runId) return null;
  const index = state.candidates.findIndex((candidate) => candidate.id === input.candidateId);
  if (index < 0) return null;
  const candidates = [...state.candidates];
  const candidate = { ...candidates[index] };
  const checkpoint = input.checkpoint || null;
  if (checkpoint) {
    candidate.discoveryCheckpoint = checkpoint;
    const facts = (checkpoint.result && typeof checkpoint.result === 'object' ? checkpoint.result : {}) as Record<string, unknown>;
    if (facts.membershipState === 'joined') {
      candidate.membershipState = 'joined';
      if (typeof facts.groupId === 'string' && facts.groupId) candidate.groupId = facts.groupId;
    }
    if (Number.isFinite(facts.memberCount)) candidate.memberCount = Number(facts.memberCount);
    if (facts.chatType === 'group' || facts.chatType === 'community') candidate.chatType = facts.chatType;
    if (facts.topicMatch === 'match' || facts.topicMatch === 'mismatch') candidate.topicMatch = facts.topicMatch;
    if (typeof facts.canWrite === 'boolean') candidate.canWrite = facts.canWrite;
    if (['allowed', 'forbidden', 'operator_confirmed', 'inferred_allowed'].includes(String(facts.adsPolicy))) {
      candidate.adsPolicy = facts.adsPolicy as RunCandidate['adsPolicy'];
    }
    if (facts.activityState === 'active' || facts.activityState === 'dead') candidate.activityState = facts.activityState;
    if (facts.accessible === true) candidate.accessState = 'available';
    if (facts.targetVerified === true) candidate.linkState = 'valid';
  }
  candidates[index] = candidate;
  return {
    ...state, candidates,
    activeCandidateId: candidate.id,
    activeCandidateName: input.name || candidate.name,
    activeCandidateLink: input.link || candidate.link,
    activeCandidateStartedAt: state.activeCandidateId === candidate.id && state.activeCandidateStartedAt ? state.activeCandidateStartedAt : now,
  };
}

export function clearActive(state: DiscoveryRunState): DiscoveryRunState {
  return state.activeCandidateId ? { ...state, ...clearedActive } : state;
}

/** Technical problem with this candidate: keep it queued but do not dispatch it before `until`. */
export function releaseCandidate(state: DiscoveryRunState, candidateId: string, until: number): DiscoveryRunState {
  const candidates = state.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, skipUntil: until } : candidate);
  return { ...state, ...(state.activeCandidateId === candidateId ? clearedActive : {}), candidates };
}

function targetIdentity(candidate: RunCandidate) {
  return candidate.groupId ? `group:${candidate.groupId}` : `invite:${candidate.link}`;
}

/** Goal progress counts this run's targets plus those already confirmed during this run. */
export function runTargetCount(state: DiscoveryRunState) {
  const current = state.candidates.filter((candidate) => candidate.preflightState === 'target' && candidate.checkedRunId === state.runId).length;
  return current + (state.confirmedThisRun || 0);
}

/** Finishes a running run once its goal is reached or the plan is exhausted with nothing left queued. */
export function settleRun(state: DiscoveryRunState, now: number): DiscoveryRunState {
  if (!state.running) return state;
  const queued = state.candidates.some((candidate) => candidate.preflightState === 'queued');
  const reached = runTargetCount(state) >= state.goal;
  const exhausted = state.sourceExhausted && !queued && !reached;
  if (!reached && !exhausted) return state;
  return { ...state, ...clearedActive, running: false, done: true, completionReason: reached ? 'goal_reached' : 'sources_exhausted', lastActivityAt: now };
}

/** The factual outcome of one WhatsApp check (port of the tab's applyLocalPreflightResults + metrics). */
export function applyResult(state: DiscoveryRunState, candidateId: string, payload: RunResultPayload, now: number): DiscoveryRunState | null {
  if (payload.runId && payload.runId !== state.runId) return null;
  const index = state.candidates.findIndex((candidate) => candidate.id === candidateId);
  if (index < 0 || state.candidates[index].preflightState !== 'queued') return null;
  const candidate = state.candidates[index];
  const result = payload.result || {};
  const completedAt = Number.isFinite(payload.completedAt) ? payload.completedAt : now;
  const observedName = typeof result.observedName === 'string' && result.observedName.trim() ? result.observedName.trim() : candidate.name;
  const memberCount = typeof result.memberCount === 'number' && Number.isFinite(result.memberCount) ? result.memberCount : null;
  const reasonCodes = Array.isArray(payload.reasonCodes) ? payload.reasonCodes.map(String) : [];
  let next: RunCandidate = {
    ...candidate,
    name: observedName,
    checkedAt: Math.floor(completedAt / 1000),
    memberCount: memberCount ?? candidate.memberCount,
    groupId: typeof result.groupId === 'string' ? result.groupId : candidate.groupId,
    leaveReason: payload.leaveReason || null,
    chatType: result.chatType === 'community' ? 'community' : result.chatType === 'group' ? 'group' : candidate.chatType,
    activityState: result.activityState === 'active' || result.activityState === 'dead' ? result.activityState : 'unknown',
    topicMatch: result.topicMatch === 'match' || result.topicMatch === 'mismatch' ? result.topicMatch : 'unknown',
    canWrite: typeof result.canWrite === 'boolean' ? result.canWrite : null,
    adsPolicy: ['allowed', 'forbidden', 'operator_confirmed', 'inferred_allowed'].includes(String(result.adsPolicy)) ? result.adsPolicy as RunCandidate['adsPolicy'] : 'unknown',
    membershipState: payload.leftAfterCheck ? 'left' : result.membershipState === 'joined' ? 'joined' : result.membershipState === 'pending' ? 'pending' : candidate.membershipState,
    accessState: result.accessible === true ? 'available' : result.accessible === false ? 'unavailable' : candidate.accessState,
    linkState: result.reason === 'invalid_whatsapp_link' ? 'invalid' : result.targetVerified === true ? 'valid' : candidate.linkState,
    inspectionState: result.status === 'inspected' || result.status === 'manual_review' ? 'inspected' : 'failed',
    decision: payload.decision === 'review' ? 'review' : payload.decision === 'target' ? 'target' : payload.decision === 'unavailable' ? 'unavailable' : 'rejected',
    reasonCodes,
    preflightState: payload.decision,
    preflightReasonCodes: reasonCodes,
    leftAfterCheck: payload.leftAfterCheck === true,
    checkedRunId: state.runId,
    updatedAt: Math.floor(completedAt / 1000),
    skipUntil: undefined,
  };
  let duplicates = state.duplicates;
  if (next.preflightState === 'target') {
    const identity = targetIdentity(next);
    if (state.candidates.some((other) => other.id !== next.id && other.preflightState === 'target' && targetIdentity(other) === identity)) {
      duplicates += 1;
      next = { ...next, decision: 'rejected', preflightState: 'rejected', preflightReasonCodes: ['duplicate_joined_chat'], reasonCodes: ['duplicate_joined_chat'] };
    }
  }
  const candidates = [...state.candidates];
  candidates[index] = next;
  const metrics = state.discoveryMetrics || { completed: 0, targets: 0, totalCheckMs: 0, reasons: {} };
  const reasons = { ...metrics.reasons };
  for (const reason of reasonCodes) reasons[reason] = (reasons[reason] || 0) + 1;
  return settleRun({
    ...state,
    ...(state.activeCandidateId === candidateId ? clearedActive : {}),
    candidates,
    duplicates,
    discoveryMetrics: {
      completed: metrics.completed + 1,
      targets: metrics.targets + (payload.decision === 'target' ? 1 : 0),
      totalCheckMs: metrics.totalCheckMs + (Number(payload.durationMs) || 0),
      reasons,
    },
    lastCheckedName: candidate.name || 'WhatsApp chat',
    lastCheckedDecision: payload.decision,
    lastCheckedAt: completedAt,
    lastCheckedReasonCodes: reasonCodes,
    lastActivityAt: now,
  }, now);
}

/** Time for the next Telegram step: the run is active, the plan is not done and the check queue is short. */
export function needsSourceStep(state: DiscoveryRunState, now: number) {
  return state.running && !state.sourceExhausted && queuedCount(state, now) < SOURCE_TARGET_QUEUE;
}

/**
 * One crawled Telegram step: previews were already parsed and checked against D1 for duplicates by the
 * caller (previewTelegramDiscoveryText). Port of the tab's applyWorkOsLocalDiscoverySourceBatchViaCdp.
 */
export function applySourceBatch(
  state: DiscoveryRunState,
  batch: SourceBatch,
  outcomes: SourcePreviewOutcome[],
  now: number,
): { state: DiscoveryRunState; added: number; duplicates: number; rejected: number; errors: number; sourceStats: SourceFeedbackEvent[] } {
  const byKey = new Map(state.candidates.map((candidate) => [`${candidate.platform}|${candidate.link}`, candidate]));
  const issues: RunIssue[] = [...(batch.errors || [])];
  let added = 0, duplicates = 0, rejected = 0, errors = issues.length;
  const sourceStats: SourceFeedbackEvent[] = [];
  for (const outcome of outcomes) {
    if (!outcome.ok) { errors += 1; issues.push({ reason: outcome.reason, query: outcome.query }); continue; }
    added += outcome.added;
    duplicates += outcome.duplicates;
    sourceStats.push({ sourceUrl: outcome.sourceUrl, added: outcome.added, duplicates: outcome.duplicates });
    for (const preview of outcome.previews) {
      const key = `${preview.platform}|${preview.link}`;
      if (byKey.has(key)) continue;
      const candidate: RunCandidate = { ...preview, preflightState: 'queued', preflightReasonCodes: [], leftAfterCheck: false };
      if (hardNoise(candidate)) { rejected += 1; byKey.set(key, rejectAsNoise(candidate)); }
      else byKey.set(key, candidate);
    }
  }
  const failures = errors ? state.sourceFailures + 1 : 0;
  const stopped = errors > 0 && state.sourceFailures >= MAX_SOURCE_FAILURES;
  const next: DiscoveryRunState = {
    ...state,
    telegramCursor: errors ? state.telegramCursor : batch.nextCursor,
    sourceTotal: batch.totalTasks || state.sourceTotal,
    sourceErrors: state.sourceErrors + errors,
    sourceFailures: failures,
    sourceIssues: [...issues, ...(batch.warnings || [])].slice(0, 8),
    running: stopped ? false : state.running,
    completionReason: stopped ? 'source_error' : state.completionReason,
    searched: state.searched + batch.searched,
    processed: state.processed + added + duplicates,
    duplicates: state.duplicates + duplicates,
    rejected: state.rejected + rejected,
    candidates: [...byKey.values()],
    sourceExhausted: state.sourceExhausted || (errors === 0 && batch.done),
    lastActivityAt: now,
  };
  return { state: settleRun(next, now), added, duplicates, rejected, errors, sourceStats };
}

/** «Підтвердити» succeeded in D1: the result leaves the run and counts toward this run's goal. */
export function markConfirmed(state: DiscoveryRunState, candidateId: string): DiscoveryRunState {
  if (!state.candidates.some((candidate) => candidate.id === candidateId)) return state;
  return {
    ...state,
    candidates: state.candidates.filter((candidate) => candidate.id !== candidateId),
    confirmedThisRun: (state.confirmedThisRun || 0) + 1,
  };
}

/** «Архівувати всі» succeeded in D1 for these results. */
export function removeCandidates(state: DiscoveryRunState, ids: Iterable<string>): DiscoveryRunState {
  const remove = new Set(ids);
  return { ...state, candidates: state.candidates.filter((candidate) => !remove.has(candidate.id)) };
}

/** Operator: a target or a chat waiting for a decision goes to «Нецільові» (D1 only on «Архівувати всі»). */
export function moveToNonTarget(state: DiscoveryRunState, candidateId: string): DiscoveryRunState {
  return {
    ...state,
    candidates: state.candidates.map((candidate) => candidate.id === candidateId
      ? { ...candidate, decision: 'rejected', preflightState: 'rejected', reasonCodes: ['operator_rejected'], preflightReasonCodes: ['operator_rejected'] }
      : candidate),
  };
}

/** Operator: put an incomplete result back into the queue; an already joined chat is not joined again. */
export function retryCandidate(state: DiscoveryRunState, candidateId: string, now: number): DiscoveryRunState {
  const stored = state.candidates.find((candidate) => candidate.id === candidateId);
  if (!stored || state.running) return state;
  const recovered: RunCandidate = {
    ...stored, preflightState: 'queued', preflightReasonCodes: [], decision: 'review', reasonCodes: [],
    discoveryCheckpoint: resetDiscoveryRetryCheckpoint(stored, now), skipUntil: undefined,
  };
  return {
    ...state, done: false, completionReason: null,
    candidates: [...state.candidates.filter((candidate) => candidate.id !== candidateId), recovered],
    pauseSummary: { at: now, cursor: state.telegramCursor, targets: 0, rejected: 0, skipped: 0, unavailable: 0, unverified: 1, archiveFailed: 0 },
  };
}

function feedbackSourceKey(value: string) {
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    const channel = (parts[0] === 's' ? parts[1] : parts[0]) || '';
    return channel ? 'https://t.me/s/' + channel : '';
  } catch { return ''; }
}

/** Source ranking feedback (was the tab's localStorage), bounded to the 500 most recently used sources. */
export function updateSourceFeedback(feedback: SourceFeedback, events: SourceFeedbackEvent[], now: number): SourceFeedback {
  const next: SourceFeedback = { ...feedback };
  for (const event of events.slice(0, 80)) {
    const source = feedbackSourceKey(String(event.sourceUrl || ''));
    if (!source) continue;
    const current: Partial<SourceFeedbackEntry> = next[source] || {};
    let delta = 0;
    let saturatedUntil = Number(current.saturatedUntil) || 0;
    if (event.decision) {
      const reasons = event.reasonCodes || [];
      const viable = Number.isFinite(event.memberCount) && Number(event.memberCount) >= 700 && Number(event.memberCount) <= 18000 && event.canWrite !== false;
      delta = event.decision === 'target' ? 80
        : reasons.includes('too_few_members') || reasons.includes('cannot_write') ? -20
          : reasons.includes('invalid_whatsapp_link') ? -12
            : viable ? 24
              : event.decision === 'rejected' ? -8 : 0;
      if (delta > 0) saturatedUntil = 0;
    } else {
      const added = Number(event.added) || 0;
      const duplicates = Number(event.duplicates) || 0;
      delta = added > 0 ? Math.min(24, 8 + added * 4) : duplicates > 0 ? -10 : -2;
      if (added > 0) saturatedUntil = 0;
      else if (duplicates > 0) saturatedUntil = Math.max(saturatedUntil, now + 6 * 60 * 60 * 1000);
    }
    next[source] = {
      score: Math.max(-120, Math.min(240, (Number(current.score) || 0) + delta)),
      lastCrawledAt: event.decision ? (Number(current.lastCrawledAt) || 0) : now,
      lastOutcomeAt: event.decision ? now : (Number(current.lastOutcomeAt) || 0),
      added: (Number(current.added) || 0) + (Number(event.added) || 0),
      duplicates: (Number(current.duplicates) || 0) + (Number(event.duplicates) || 0),
      targets: (Number(current.targets) || 0) + (event.decision === 'target' ? 1 : 0),
      saturatedUntil,
    };
  }
  return Object.fromEntries(Object.entries(next)
    .sort((a, b) => (a[1].lastCrawledAt || a[1].lastOutcomeAt) - (b[1].lastCrawledAt || b[1].lastOutcomeAt))
    .slice(-500));
}
