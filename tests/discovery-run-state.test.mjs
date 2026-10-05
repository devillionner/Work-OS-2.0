import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_RUN, applyResult, applySourceBatch, canResume, markActive, markConfirmed, moveToNonTarget, needsSourceStep,
  nextCandidateTask, nextSkipExpiry, pauseOnSourceBlock, pauseRun, queuedCount, releaseCandidate, removeCandidates,
  resumeRun, retryCandidate, runTargetCount, startRun, updateSourceFeedback,
} from '../lib/chat-discovery/run-state.ts';

// The autonomous Discovery run's rules, moved out of the Work OS tab (sessionStorage + CDP-injected JS)
// into pure functions the owner Durable Object applies (2026-10-04).

const NOW = 1_800_000_000_000;

function candidate(id, extra = {}) {
  return {
    id, platform: 'whatsapp', name: `Chat ${id}`, link: `https://chat.whatsapp.com/${id}`, localOnly: true,
    discoveredAt: 1, checkedAt: null, memberCount: null, chatType: 'unknown', activityState: 'unknown', topicMatch: 'unknown',
    canWrite: null, adsPolicy: 'unknown', membershipState: 'not_checked', accessState: 'unknown', linkState: 'unknown',
    inspectionState: 'not_checked', decision: 'review', reasonCodes: [], importedChatId: null, updatedAt: 1, version: 1,
    sources: [], preflightState: 'queued', preflightReasonCodes: [], ...extra,
  };
}

function running(candidates, extra = {}) {
  return { ...EMPTY_RUN, runId: 'run-1', running: true, goal: 2, candidates, ...extra };
}

const targetPayload = (extra = {}) => ({
  decision: 'target', reasonCodes: [], completedAt: NOW, durationMs: 1200, runId: 'run-1',
  result: { status: 'inspected', observedName: 'Українці Берлін', memberCount: 900, chatType: 'group', topicMatch: 'match',
    canWrite: true, membershipState: 'joined', accessible: true, targetVerified: true, groupId: 'g1', ...extra },
});

void test('a new run carries over finished unconfirmed results but not the old queue', () => {
  const previous = running([candidate('a', { preflightState: 'target' }), candidate('b'), candidate('c', { preflightState: 'rejected' })]);
  const next = startRun(previous, { runId: 'run-2', goal: 500, now: NOW });
  assert.equal(next.runId, 'run-2');
  assert.equal(next.goal, 100, 'goal is clamped to 1..100');
  assert.equal(next.running, true);
  assert.deepEqual(next.candidates.map((item) => item.id), ['a', 'c']);
  assert.equal(next.confirmedThisRun, 0);
});

void test('the next task is the highest-priority dispatchable candidate; noise is rejected, cooled-down and active ones skipped', () => {
  const state = running([
    candidate('plain'),
    candidate('ua', { name: 'Українці Мюнхен чат' }),
    candidate('noise', { name: 'TikTok' }),
    candidate('cooling', { name: 'Українці Відень оголошення', skipUntil: NOW + 10_000 }),
  ]);
  const { state: next, task } = nextCandidateTask(state, NOW);
  assert.equal(task.candidateId, 'ua');
  assert.equal(task.action, 'join_and_inspect');
  assert.equal(task.expectedTarget.link, 'https://chat.whatsapp.com/ua');
  assert.equal(next.candidates.find((item) => item.id === 'noise').preflightState, 'rejected');
  assert.equal(queuedCount(next, NOW), 2);
  assert.equal(nextSkipExpiry(next, NOW), NOW + 10_000);

  const busy = markActive(next, { candidateId: 'ua', runId: 'run-1' }, NOW);
  assert.equal(nextCandidateTask(busy, NOW).task.candidateId, 'plain', 'the active candidate is never dispatched twice');
  assert.equal(nextCandidateTask({ ...busy, running: false }, NOW).task, null);
});

void test('a checkpoint reported mid-check updates the candidate facts so a retry never joins twice', () => {
  const state = running([candidate('a')]);
  const marked = markActive(state, { candidateId: 'a', runId: 'run-1', checkpoint: { attempts: 1, result: { membershipState: 'joined', groupId: 'g9', memberCount: 1200 } } }, NOW);
  const stored = marked.candidates[0];
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.groupId, 'g9');
  assert.equal(stored.memberCount, 1200);
  assert.equal(marked.activeCandidateId, 'a');
  assert.equal(nextCandidateTask(releaseCandidate(marked, 'a', NOW + 5000), NOW + 6000).task.checkpoint.attempts, 1);
  assert.equal(markActive(state, { candidateId: 'a', runId: 'other-run' }, NOW), null, 'a stale run cannot touch the current one');
});

void test('results apply facts and metrics, duplicate joined targets are rejected and reaching the goal finishes the run', () => {
  let state = running([candidate('a'), candidate('b'), candidate('c')]);
  state = applyResult(state, 'a', targetPayload(), NOW);
  const a = state.candidates.find((item) => item.id === 'a');
  assert.equal(a.preflightState, 'target');
  assert.equal(a.name, 'Українці Берлін');
  assert.equal(a.memberCount, 900);
  assert.equal(a.checkedRunId, 'run-1');
  assert.equal(state.discoveryMetrics.completed, 1);
  assert.equal(state.lastCheckedDecision, 'target');

  const duplicate = applyResult(state, 'b', targetPayload(), NOW);
  assert.equal(duplicate.candidates.find((item) => item.id === 'b').preflightState, 'rejected');
  assert.deepEqual(duplicate.candidates.find((item) => item.id === 'b').reasonCodes, ['duplicate_joined_chat']);

  assert.equal(applyResult(state, 'a', targetPayload(), NOW), null, 'an already finished candidate is not re-applied');
  assert.equal(applyResult(state, 'b', { ...targetPayload(), runId: 'old' }, NOW), null);

  const done = applyResult(state, 'c', targetPayload({ groupId: 'g2' }), NOW);
  assert.equal(runTargetCount(done), 2);
  assert.equal(done.running, false);
  assert.equal(done.done, true);
  assert.equal(done.completionReason, 'goal_reached');
});

void test('a Telegram step adds new previews, skips known links, rejects noise and stops after repeated errors', () => {
  const state = running([candidate('known')], { goal: 50 });
  const preview = (id, name) => ({ ...candidate(id, { name }), preflightState: undefined });
  const { state: next, added, duplicates, rejected, sourceStats } = applySourceBatch(state,
    { nextCursor: 4, searched: 3, done: false, totalTasks: 40 },
    [{ ok: true, sourceUrl: 'https://t.me/s/ua_berlin', previews: [preview('known', 'x'), preview('new', 'Українці'), preview('ev', 'Eventbrite реєстрація 2026')], added: 3, duplicates: 1 }],
    NOW);
  assert.equal(added, 3);
  assert.equal(duplicates, 1);
  assert.equal(rejected, 1);
  assert.equal(next.telegramCursor, 4);
  assert.equal(next.searched, 3);
  assert.deepEqual(next.candidates.map((item) => [item.id, item.preflightState]), [['known', 'queued'], ['new', 'queued'], ['ev', 'rejected']]);
  assert.deepEqual(sourceStats, [{ sourceUrl: 'https://t.me/s/ua_berlin', added: 3, duplicates: 1 }]);

  const failing = (current) => applySourceBatch(current, { nextCursor: 9, searched: 0, done: false, totalTasks: 40 },
    [{ ok: false, sourceUrl: 'https://t.me/s/x', query: 'q', reason: 'preview_failed' }], NOW).state;
  const once = failing(next);
  assert.equal(once.telegramCursor, 4, 'a failed step keeps the cursor');
  assert.equal(once.running, true);
  const stopped = failing(failing(once));
  assert.equal(stopped.running, false);
  assert.equal(stopped.completionReason, 'source_error');
  assert.equal(canResume(stopped), true);
});

void test('an exhausted plan with nothing queued finishes the run; Telegram blocks and operator pauses are resumable', () => {
  const state = running([candidate('a', { preflightState: 'rejected' })], { goal: 50 });
  const exhausted = applySourceBatch(state, { nextCursor: 40, searched: 1, done: true, totalTasks: 40 }, [], NOW).state;
  assert.equal(exhausted.done, true);
  assert.equal(exhausted.completionReason, 'sources_exhausted');

  // A stray 'pause' for the step that just finished the plan must not undo the honest sources_exhausted
  // stop (a Telegram block and an exhausted plan can race if the runner's pause message for the last
  // step arrives after the step's own source_result already settled the run).
  const raced = pauseOnSourceBlock(exhausted, { reason: 'telegram_flood_wait', query: 'Українці Берлін' }, NOW + 1000);
  assert.equal(raced, exhausted, 'pauseOnSourceBlock is a no-op once the run is no longer running');
  assert.equal(raced.completionReason, 'sources_exhausted', 'the honest reason is not overwritten by a late pause');

  const blocked = pauseOnSourceBlock(running([candidate('q')]), { reason: 'telegram_flood_wait', query: 'Українці Берлін' }, NOW);
  assert.equal(blocked.running, false);
  assert.equal(blocked.completionReason, 'source_error');
  assert.equal(resumeRun(blocked, NOW).running, true);

  const paused = pauseRun(running([candidate('q'), candidate('t', { preflightState: 'target' })]), NOW);
  assert.equal(paused.running, false);
  assert.equal(paused.pauseSummary.unverified, 1);
  assert.equal(paused.pauseSummary.targets, 1);
  assert.equal(canResume(paused), true);
  assert.equal(needsSourceStep(paused, NOW), false);
  assert.equal(needsSourceStep(resumeRun(paused, NOW), NOW), true);
});

void test('operator actions: confirm counts toward the goal, archive removes, reject moves, retry re-queues without a second join', () => {
  const state = running([candidate('t', { preflightState: 'target', checkedRunId: 'run-1' }), candidate('r', { preflightState: 'review' }), candidate('x', { preflightState: 'rejected' })], { goal: 5 });
  const confirmed = markConfirmed(state, 't');
  assert.equal(confirmed.candidates.length, 2);
  assert.equal(runTargetCount(confirmed), 1);
  assert.deepEqual(removeCandidates(confirmed, ['x']).candidates.map((item) => item.id), ['r']);
  assert.equal(moveToNonTarget(confirmed, 'r').candidates.find((item) => item.id === 'r').preflightState, 'rejected');

  const stopped = { ...state, running: false, candidates: [candidate('u', { preflightState: 'unavailable', membershipState: 'joined', groupId: 'g5' })] };
  const retried = retryCandidate(stopped, 'u', NOW);
  const back = retried.candidates[0];
  assert.equal(back.preflightState, 'queued');
  assert.equal(back.discoveryCheckpoint.attempts, 0);
  assert.equal(back.discoveryCheckpoint.result.membershipState, 'joined');
  assert.equal(back.discoveryCheckpoint.result.groupId, 'g5');
  assert.equal(retryCandidate(state, 'r', NOW), state, 'no retry while the run is running');
});

void test('source feedback rewards sources that produced targets and saturates ones that only repeat duplicates', () => {
  let feedback = updateSourceFeedback({}, [{ sourceUrl: 'https://t.me/s/good/12', added: 2 }, { sourceUrl: 'https://t.me/dups', duplicates: 3 }], NOW);
  assert.equal(feedback['https://t.me/s/good'].score, 16);
  assert.equal(feedback['https://t.me/s/dups'].saturatedUntil, NOW + 6 * 60 * 60 * 1000);
  feedback = updateSourceFeedback(feedback, [{ sourceUrl: 'https://t.me/s/good', decision: 'target' }], NOW + 1);
  assert.equal(feedback['https://t.me/s/good'].score, 96);
  assert.equal(feedback['https://t.me/s/good'].targets, 1);
  assert.equal(Object.keys(updateSourceFeedback({}, [{ sourceUrl: 'not a url' }], NOW)).length, 0);
});
