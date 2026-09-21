import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continueDiscoveryRun,
  evaluateDiscoveryCandidate,
  handoffDiscoveryCandidate,
  readDiscoveryWorkspace,
  startDiscoveryRun,
} from '../lib/chat-discovery/domain.ts';
import { applyDiscoveryInspection } from '../lib/chat-discovery/inspection.ts';
import { discoverPublicWeb, extractInviteRecords, isLikelyUkrainianCommunity, safePublicUrl } from '../lib/chat-discovery/public-web.ts';
import { changeChatLeave } from '../lib/chats/leave.ts';
import { readChatState } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import { localDatabase } from './helpers/local-d1.mjs';

function html(body) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

void test('public discovery extracts canonical WhatsApp/Viber invites and keeps provenance', async () => {
  const source = {
    sourceUrl: 'https://example.org/list',
    sourceTitle: 'Українці в Берліні',
    query: '"Berlin" українці',
    seedLabel: 'Берлін',
    seedKind: 'city',
    context: 'Українці Німеччина',
  };
  const records = extractInviteRecords(
    '<p>Українці Берлін · Барахолка https://chat.whatsapp.com/AbCdEf123</p>' +
      '<p>Допомога українцям https://invite.viber.com/?g2=Zm9vYmFy</p>',
    ['whatsapp', 'viber'],
    source,
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].platform, 'whatsapp');
  assert.equal(records[0].link, 'https://chat.whatsapp.com/AbCdEf123');
  assert.match(records[0].source.context, /Українц/i);
  assert.equal(records[1].platform, 'viber');
  assert.match(records[1].link, /^https:\/\/invite\.viber\.com\/\?g2=/);
});

void test('public discovery rejects generic and spam WhatsApp groups before persistence', () => {
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin батьки community'), true);
  assert.equal(isLikelyUkrainianCommunity('Berlin expats international community'), false);
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin crypto signals bitcoin'), false);

  const base = { sourceUrl:'https://example.org/list', sourceTitle:'Directory', query:'Berlin', seedLabel:'Berlin', seedKind:'city', context:'' };
  assert.equal(extractInviteRecords('International dating https://chat.whatsapp.com/Spam123', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin crypto signals https://chat.whatsapp.com/Spam456', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin батьки https://chat.whatsapp.com/Good123', ['whatsapp'], base).length, 1);
});

void test('public discovery rejects local/literal hosts and searches a bounded seed batch', async () => {
  assert.equal(safePublicUrl('http://127.0.0.1/test'), false);
  assert.equal(safePublicUrl('http://localhost/test'), false);
  assert.equal(safePublicUrl('https://example.org/test'), true);

  const calls = [];
  const result = await discoverPublicWeb({
    platforms: ['whatsapp'],
    cursor: 0,
    maxQueries: 2,
    pageLimit: 0,
    includeCurated: false,
  }, async (url) => {
    calls.push(url);
    return html('<div>Українці Berlin барахолка https://chat.whatsapp.com/TestInvite123</div>');
  });
  assert.equal(result.searched, 2);
  assert.equal(calls.length, 2);
  assert.ok(result.totalTasks > 100);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((item) => item.link === 'https://chat.whatsapp.com/TestInvite123'));
  assert.ok(result.records.every((item) => item.source.query.includes('українці')));
});

void test('qualification is fail-closed until every target criterion is confirmed', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    accessState: 'available',
    linkState: 'valid',
  }), { decision: 'target', reasonCodes: ['all_required_confirmed'] });

  const review = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: null,
    adsPolicy: 'unknown',
    activityState: 'unknown',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(review.decision, 'review');
  assert.ok(review.reasonCodes.includes('unknown_can_write'));
  assert.ok(review.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(review.reasonCodes.includes('unknown_activity'));

  const rejected = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 699,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
  }, 700);
  assert.equal(rejected.decision, 'rejected');
  assert.ok(rejected.reasonCodes.includes('too_few_members'));
});

void test('discovery run persists one canonical candidate, provenance and owner isolation', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  assert.equal(run.status, 'running');

  const fetcher = async (url) => {
    if (url.includes('search.brave.com')) {
      return html('<article>Українці Berlin · Барахолка https://chat.whatsapp.com/PersistInvite123</article>');
    }
    return html('<html><title>Directory</title></html>');
  };
  const step = await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  assert.equal(step.batch.searched, 6);
  assert.equal(step.batch.added, 1);
  assert.equal(step.run.foundCount, 1);

  const workspace = await readDiscoveryWorkspace(db, 'u');
  assert.equal(workspace.candidates.length, 1);
  assert.equal(workspace.importedCount, 0);
  assert.equal(workspace.candidates[0].platform, 'whatsapp');
  assert.equal(workspace.candidates[0].decision, 'review');
  assert.ok(workspace.candidates[0].reasonCodes.includes('unknown_member_count'));
  assert.ok(workspace.candidates[0].sources.length >= 1);

  const foreign = await readDiscoveryWorkspace(db, 'other');
  assert.equal(foreign.candidates.length, 0);
  assert.equal(foreign.run, null);
});

void test('discovery membership follows real chat transitions and ignores stale attempts', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html('<div>Українці Praha допомога https://chat.whatsapp.com/MembershipInvite123</div>')
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate);
  const handed = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);

  const initial = await readChatState(db, 'u', handed.chatId);
  assert.ok(initial);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'not_checked');

  assert.equal((await transitionChat(db, { userId:'u', chat:initial, action:'waiting', accountId:null, now:103 })).ok, true);
  let linked = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.equal(linked.membershipState, 'pending');
  const pendingVersion = linked.version;

  assert.equal((await transitionChat(db, { userId:'u', chat:initial, action:'waiting', accountId:null, now:104 })).ok, false);
  linked = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.equal(linked.membershipState, 'pending');
  assert.equal(linked.version, pendingVersion);

  const waiting = await readChatState(db, 'u', handed.chatId);
  assert.ok(waiting);
  assert.equal((await transitionChat(db, { userId:'u', chat:waiting, action:'approved', accountId:null, now:105 })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');

  const ready = await readChatState(db, 'u', handed.chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:106, reason:'Не підходить' })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');

  const archived = await readChatState(db, 'u', handed.chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:107, confirm:true })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'left');

  const left = await readChatState(db, 'u', handed.chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:108, confirm:false })).ok, true);
  assert.equal((await readDiscoveryWorkspace(db, 'u')).candidates[0].membershipState, 'joined');
});

void test('discovery handoff creates one to-join chat and is idempotent', async (t) => {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html('<div>Українці Warszawa допомога https://chat.whatsapp.com/HandoffInvite123</div>')
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const before = await readDiscoveryWorkspace(db, 'u');
  const candidate = before.candidates[0];
  assert.ok(candidate);

  const first = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);
  assert.equal(first.existing, false);
  assert.equal(first.workflowStatus, 'to_join');

  const chat = await db.prepare(`SELECT id,user_id,platform,workflow_status,normalized_link
    FROM chats WHERE id=?1`).bind(first.chatId).first();
  assert.deepEqual(
    [chat.user_id, chat.platform, chat.workflow_status, chat.normalized_link],
    ['u', 'whatsapp', 'to_join', 'https://chat.whatsapp.com/HandoffInvite123'],
  );
  const event = await db.prepare(`SELECT event_type,chat_id,source_key FROM activity_events
    WHERE user_id='u' AND source_key=?1`).bind(`chat-discovery-import:${candidate.id}`).first();
  assert.equal(event.event_type, 'chat_discovery_imported');
  assert.equal(event.chat_id, first.chatId);

  const after = await readDiscoveryWorkspace(db, 'u');
  const imported = after.candidates.find((item) => item.id === candidate.id);
  assert.equal(imported.importedChatId, first.chatId);
  assert.equal(after.importedCount, 1);
  const again = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 103);
  assert.equal(again.chatId, first.chatId);
  assert.equal(again.existing, true);

  const count = await db.prepare(`SELECT COUNT(*) AS count FROM chats
    WHERE user_id='u' AND normalized_link='https://chat.whatsapp.com/HandoffInvite123'`).first();
  assert.equal(Number(count.count), 1);
});


async function importedCandidate(t, suffix) {
  const db = await localDatabase(t);
  const run = await startDiscoveryRun(db, 'u', { platforms: ['whatsapp'], goal: 30, minMembers: 700 }, 100);
  const link = `https://chat.whatsapp.com/${suffix}`;
  const fetcher = async (url) => url.includes('search.brave.com')
    ? html(`<div>Українці Praha допомога ${link}</div>`)
    : html('<html></html>');
  await continueDiscoveryRun(db, 'u', run.id, 101, fetcher);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates[0];
  assert.ok(candidate);
  const handed = await handoffDiscoveryCandidate(db, 'u', candidate.id, candidate.version, 102);
  const fresh = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.ok(fresh);
  return { db, candidate: fresh, chatId: handed.chatId };
}

void test('inspection promotes an accepted WhatsApp target into ready workflow', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTarget123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.membershipState, 'joined');
  assert.equal(outcome.needsQualification, false);
  assert.equal(outcome.needsExternalLeave, false);
  assert.equal(outcome.autoArchived, false);
  const chat = await readChatState(db, 'u', chatId);
  assert.equal(chat.workflow_status, 'ready');
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.decision, 'target');
  assert.equal(stored.inspectionState, 'inspected');
  assert.equal(stored.memberCount, 900);
});

void test('joined inspection with unknown rules stays ready but explicitly needs qualification', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectReview123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      canWrite:null, adsPolicy:'unknown', activityState:'unknown',
    },
  }, 110);
  assert.equal(outcome.decision, 'review');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.needsQualification, true);
  assert.equal(outcome.needsExternalLeave, false);
  assert.ok(outcome.reasonCodes.includes('unknown_can_write'));
  assert.ok(outcome.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(outcome.reasonCodes.includes('unknown_activity'));
});

void test('joined rejected chat is not hidden before external leave succeeds', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectReject123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:500,
      canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.needsExternalLeave, true);
  assert.equal(outcome.autoArchived, false);
  assert.ok(outcome.reasonCodes.includes('too_few_members'));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('known invalid invite before join is safely archived without claiming an external leave', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectMissing123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: { status:'failed', accessible:false, reason:'whatsapp_chat_missing' },
  }, 110);
  assert.equal(outcome.decision, 'unavailable');
  assert.equal(outcome.workflowStatus, 'archived');
  assert.equal(outcome.autoArchived, true);
  assert.equal(outcome.needsExternalLeave, false);
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'archived');
});

void test('inspection is owner scoped and optimistic', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectGuard123');
  await assert.rejects(
    applyDiscoveryInspection(db, 'other', {
      candidateId:candidate.id, expectedVersion:candidate.version,
      result:{status:'pending',accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат не знайдений/,
  );
  await assert.rejects(
    applyDiscoveryInspection(db, 'u', {
      candidateId:candidate.id, expectedVersion:candidate.version + 1,
      result:{status:'pending',accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат уже змінився/,
  );
});
