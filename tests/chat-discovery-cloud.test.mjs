import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateDiscoveryCandidate,
  readDiscoveryWorkspace,
} from '../lib/chat-discovery/domain.ts';
import { applyDiscoveryInspection } from '../lib/chat-discovery/inspection.ts';
import { completeDiscoveryExternalLeave, readDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import { createWaitingCheckBatch, isWaitingCheckBatchActive, readEligibleWaitingChats, stopWaitingCheckBatch, waitingCheckStatusFromBatch } from '../lib/chats/whatsapp-waiting-check.ts';
import { buildTelegramSearchPlan, extractInviteRecords, isLikelyUkrainianCommunity } from '../lib/chat-discovery/public-web.ts';
import { confirmLocalDiscoveryPreview, inferLocalPreviewTopicMatch } from '../lib/chat-discovery/local-preview.ts';
import { changeChatLeave } from '../lib/chats/leave.ts';
import { readChatState } from '../lib/chats/state.ts';
import { transitionChat } from '../lib/chats/transitions.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('local preview relevance ignores the search query itself as evidence', () => {
  const noisySource = {
    kind:'telegram_global',
    sourceUrl:'https://search.brave.com/search?q=test',
    sourceTitle:'Telegram search · Париж',
    query:'Українці в Париж',
    seedLabel:'Париж',
    seedKind:'city',
    context:'Українці в Париж · Париж · Франція · Telegram · NOTÍCIAS E INFORMAÇÕES mercado financeiro. Whatsapp Grupo 14',
  };
  assert.equal(inferLocalPreviewTopicMatch('Telegram NOTÍCIAS mercado financeiro Whatsapp Grupo 14', [noisySource]), 'unknown');
  assert.equal(inferLocalPreviewTopicMatch('Українці Париж · барахолка та допомога', [noisySource]), 'match');
});

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

void test('search instructions cannot make unrelated WhatsApp invites look Ukrainian', () => {
  const syntheticSource = {
    kind:'telegram_global',
    sourceUrl:'https://search.brave.com/search?q=site%3At.me+Ukrainians+Berlin',
    sourceTitle:'Telegram search · Берлін',
    query:'Українці Берлін чат',
    seedLabel:'Берлін',
    seedKind:'city',
    context:'Українці Берлін · Німеччина · Telegram',
  };
  assert.equal(extractInviteRecords(
    '<article>روابط مجموعات واتساب https://chat.whatsapp.com/ArabicCatalog123</article>',
    ['whatsapp'],
    syntheticSource,
  ).length,0);
  assert.equal(extractInviteRecords(
    '<article>Українці Берлін · допомога та оголошення https://chat.whatsapp.com/UkrainianBerlin123</article>',
    ['whatsapp'],
    syntheticSource,
  ).length,1);
});

void test('public discovery rejects generic and spam WhatsApp groups before persistence', () => {
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin батьки community'), true);
  assert.equal(isLikelyUkrainianCommunity('Berlin expats international community'), false);
  assert.equal(isLikelyUkrainianCommunity('Українці Berlin crypto signals bitcoin'), false);

  const base = { sourceUrl:'https://example.org/list', sourceTitle:'Directory', query:'Berlin', seedLabel:'Berlin', seedKind:'city', context:'' };
  assert.equal(extractInviteRecords('International dating https://chat.whatsapp.com/Spam123', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin crypto signals https://chat.whatsapp.com/Spam456', ['whatsapp'], base).length, 0);
  assert.equal(extractInviteRecords('Українці Berlin батьки https://chat.whatsapp.com/Good123', ['whatsapp'], base).length, 1);
  assert.equal(extractInviteRecords('Українці Berlin батьки chat.whatsapp.com/Good456', ['whatsapp'], base)[0].link, 'https://chat.whatsapp.com/Good456');
});

void test('factual recent ad evidence can complete target qualification without manual ads confirmation', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType:'group',
    memberCount:1200,
    topicMatch:'match',
    canWrite:true,
    adsPolicy:'inferred_allowed',
    activityState:'active',
    membershipState:'joined',
    inspectionState:'inspected',
    accessState:'available',
    linkState:'valid',
  }), { decision:'target', reasonCodes:['all_required_confirmed'] });
});

void test('Telegram keyword plan is deterministic, bounded and resolves workbook placeholders', () => {
  const first = buildTelegramSearchPlan(0, 6);
  assert.equal(first.cursor, 0);
  assert.equal(first.tasks.length, 6);
  assert.ok(first.totalTasks > 1000);
  assert.equal(first.nextCursor, 6);
  assert.equal(first.done, false);
  assert.ok(first.tasks.every(task => task.query.length > 0));
  assert.ok(first.tasks.every(task => !/назва |\(назва| або країни| або міста/iu.test(task.query)));
  assert.equal(first.tasks[0].seedKind, 'city');
  assert.ok(first.tasks.some(task => task.cityLatin && task.cityLatin !== task.city));
  assert.ok(new Set(first.tasks.map(task => task.city)).size >= 2);
  const all = buildTelegramSearchPlan(0, 20);
  assert.ok(all.totalTasks > 1000);
  const sample = [
    ...buildTelegramSearchPlan(0, 20).tasks,
    ...buildTelegramSearchPlan(Math.floor(all.totalTasks / 2), 20).tasks,
    ...buildTelegramSearchPlan(Math.max(0, all.totalTasks - 20), 20).tasks,
  ];
  const seen = new Set();
  for (const task of sample) {
    const key = `${task.seedKind}|${task.country}|${task.city}|${task.template}`;
    assert.equal(seen.has(key), false, `duplicate Telegram task: ${key}`);
    seen.add(key);
  }

  const repeated = buildTelegramSearchPlan(0, 6);
  assert.deepEqual(repeated, first);
  const next = buildTelegramSearchPlan(first.nextCursor, 3);
  assert.equal(next.cursor, first.nextCursor);
  assert.ok(next.tasks.every(task => task.cursor >= first.nextCursor));
});

void test('high-intent Ukrainian templates outrank the bare-city Telegram query', () => {
  const first=buildTelegramSearchPlan(0,5).tasks;
  assert.equal(first.some(task=>task.template==='Просто назва міста'),false);
  assert.ok(first.some(task=>/Українці в місті/u.test(task.template)));
  assert.ok(first.some(task=>/Допомога українцям|Помощь украинцам/u.test(task.template)));
});

void test('qualification is fail-closed until every target criterion is confirmed', () => {
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  }), { decision: 'target', reasonCodes: ['all_required_confirmed'] });

  // Ad rules and recent activity are not criteria (operator decision 2026-10-02): an inferred ads
  // policy no longer keeps an otherwise-fully-confirmed candidate in review.
  assert.deepEqual(evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'inferred_allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  }), { decision: 'target', reasonCodes: ['all_required_confirmed'] });

  const notJoined = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'not_checked',
    inspectionState: 'inspected',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(notJoined.decision, 'review');
  assert.deepEqual(notJoined.reasonCodes, ['unknown_membership']);

  const notInspected = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 900,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    membershipState: 'joined',
    inspectionState: 'not_checked',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(notInspected.decision, 'review');
  assert.deepEqual(notInspected.reasonCodes, ['unknown_inspection']);

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

  const tooLarge = evaluateDiscoveryCandidate({
    chatType: 'group',
    memberCount: 18_001,
    topicMatch: 'match',
    canWrite: true,
    adsPolicy: 'allowed',
    activityState: 'active',
    accessState: 'available',
    linkState: 'valid',
  });
  assert.equal(tooLarge.decision, 'rejected');
  assert.ok(tooLarge.reasonCodes.includes('too_many_members'));

  assert.deepEqual(evaluateDiscoveryCandidate({
    linkState: 'invalid',
    accessState: 'unavailable',
  }), { decision: 'unavailable', reasonCodes: ['invalid_invite'] });
});

void test('discovery membership follows real chat transitions and ignores stale attempts', async (t) => {
  const db = await localDatabase(t);
  const handed = await confirmLocalDiscoveryPreview(db, 'u', {
    platform:'whatsapp', link:'https://chat.whatsapp.com/MembershipInvite123', name:'Українці Praha', sources:[],
  }, 100);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.importedChatId === handed.chatId);
  assert.ok(candidate);

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

void test('invalid auto-imported WhatsApp invite is archived safely without claiming a join', async (t) => {
  const db = await localDatabase(t);
  const handed = await confirmLocalDiscoveryPreview(db, 'u', {
    platform:'whatsapp', link:'https://chat.whatsapp.com/ExpiredBeforeJoin123', name:'Українці Berlin', sources:[],
  }, 100);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.importedChatId === handed.chatId);
  assert.ok(candidate?.importedChatId);

  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id,
    expectedVersion:candidate.version,
    result:{status:'failed',accessible:false,reason:'invalid_whatsapp_link'},
  }, 102);
  assert.equal(outcome.chatId, candidate.importedChatId);
  assert.equal(outcome.workflowStatus, 'archived');
  assert.equal(outcome.decision, 'unavailable');
  assert.equal(outcome.autoArchived, true);
  assert.equal(outcome.needsExternalLeave, false);
  assert.ok(outcome.reasonCodes.includes('invalid_invite'));

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.importedChatId, candidate.importedChatId);
  assert.equal(stored.linkState, 'invalid');
  assert.equal((await readChatState(db, 'u', candidate.importedChatId)).workflow_status, 'archived');
});

async function importedCandidate(t, suffix) {
  const db = await localDatabase(t);
  const link = `https://chat.whatsapp.com/${suffix}`;
  const handed = await confirmLocalDiscoveryPreview(db, 'u', {
    platform:'whatsapp', link, name:'Українці Praha', sources:[],
  }, 100);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.importedChatId === handed.chatId);
  assert.ok(candidate);
  return { db, candidate, chatId: handed.chatId };
}

void test('verified WhatsApp UI name replaces an approximate discovery source name', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'ObservedName123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id,
    expectedVersion:candidate.version,
    requireTargetVerification:true,
    result:{
      status:'inspected',targetVerified:true,accessible:true,membershipState:'joined',
      observedName:'Українці Прага — офіційний чат',chatType:'group',
    },
  }, 110);
  assert.equal(outcome.membershipState,'joined');
  const stored = (await readDiscoveryWorkspace(db,'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.name,'Українці Прага — офіційний чат');
});

void test('executor queue exposes only the next safe external action and clears completed targets', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ExecutorQueue123');
  const initial = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(initial.tasks.length, 1);
  assert.deepEqual(
    [initial.tasks[0].candidateId, initial.tasks[0].chatId, initial.tasks[0].action, initial.tasks[0].resultAction],
    [candidate.id, chatId, 'join_and_inspect', 'inspect'],
  );
  assert.equal(initial.tasks[0].minMembers, 700);

  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(inspected.decision, 'target');
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.length, 0);
  assert.equal((await readDiscoveryExecutorQueue(db, 'other', 10)).tasks.length, 0);
});

void test('WhatsApp pending checks wait three days and require another explicit batch start', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'PendingRecheck123');
  const first = await readDiscoveryExecutorQueue(db, 'u', 1, 200);
  assert.equal(first.tasks.length, 1);

  const pending = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:first.tasks[0].candidateVersion,
    requireTargetVerification:true,
    result:{status:'inspected',targetVerified:true,accessible:true,membershipState:'pending',observedName:'Українці Praha'},
  }, 201);
  assert.equal(pending.membershipState, 'pending');
  assert.equal(pending.workflowStatus, 'waiting');

  const stored = await db.prepare(`SELECT dc.checked_at,c.snoozed_until
    FROM chat_discovery_candidates dc JOIN chats c ON c.id=dc.imported_chat_id
    WHERE dc.id=?1`).bind(candidate.id).first();
  assert.equal(stored.checked_at,201);
  assert.ok(stored.snoozed_until>201);
  assert.equal((await readDiscoveryExecutorQueue(db,'u',1,stored.snoozed_until+1)).tasks.length,0);

  // Waiting-check batch state itself (start/claim/stop over the owner Durable Object) moved to
  // commit 3b — see tests/owner-channel.test.mjs. What stays a Discovery-side contract is that the
  // snoozed chat is simply absent from the eligible-chat snapshot until its deadline passes.
  const items = await readEligibleWaitingChats(db, 'u', stored.snoozed_until + 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, candidate.importedChatId);
});

void test('legacy waiting chats are enrolled only by the operator batch and create no Discovery candidates', async (t) => {
  const db=await localDatabase(t);
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at
  ) VALUES ('legacy-waiting','u','whatsapp','Українці Австрія',
    'https://chat.whatsapp.com/LegacyWaiting123','https://chat.whatsapp.com/LegacyWaiting123',
    'waiting',0,100,100)`).run();

  assert.equal((await readDiscoveryExecutorQueue(db,'u',1,200)).tasks.length,0);
  const items = await readEligibleWaitingChats(db, 'u', 200);
  const batch = createWaitingCheckBatch(items, 200);
  assert.equal(batch.total,1);
  assert.equal(isWaitingCheckBatchActive(batch),true);

  const stopped=stopWaitingCheckBatch(batch,201);
  const status=waitingCheckStatusFromBatch(stopped);
  assert.equal(status.active,false);
  assert.equal(status.remaining,0);
  assert.equal((await readDiscoveryExecutorQueue(db,'u',1,202)).tasks.length,0);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM chat_discovery_candidates`).first()).n,0);
});

void test('executor leave result archives a rejected joined WhatsApp chat and confirms the real external leave', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ExecutorLeave123');
  await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Random chat', chatType:'group', memberCount:900,
      topicMatch:'mismatch', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);

  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.equal(queue.tasks.length, 1);
  const task = queue.tasks[0];
  assert.equal(task.action, 'leave');
  assert.equal(task.resultAction, 'executor-leave');
  assert.equal(task.runtime, 'whatsapp_web');
  assert.deepEqual(task.expectedTarget, {name:candidate.name,link:candidate.link});
  assert.deepEqual(task.safety, {requiresTargetVerification:true,unknownState:'fail_closed'});
  assert.equal(task.chatId, chatId);

  await assert.rejects(
    completeDiscoveryExternalLeave(db, 'u', {
      candidateId: task.candidateId,
      expectedVersion: task.candidateVersion,
      chatStateToken: 'stale-token',
      targetVerified: true,
    }, 111),
    /Чат уже змінився/,
  );

  const completed = await completeDiscoveryExternalLeave(db, 'u', {
    candidateId: task.candidateId,
    expectedVersion: task.candidateVersion,
    chatStateToken: task.chatStateToken,
    targetVerified: true,
  }, 112);
  assert.equal(completed.ok, true);
  const chat = await readChatState(db, 'u', chatId);
  assert.equal(chat.workflow_status, 'archived');
  assert.equal(chat.left_at, 112);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.length, 0);
});

void test('inspection promotes an accepted WhatsApp target into ready workflow', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTarget123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
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

void test('confirmed leave adds the membership blocker to an already-review candidate and undo removes only it', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'ReviewLeaveReasons123');
  const reviewed = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Brno батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:null, adsPolicy:'unknown', activityState:'active',
    },
  }, 110);
  assert.equal(reviewed.decision, 'review');
  assert.deepEqual(reviewed.reasonCodes, ['unknown_can_write']);

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Пауза' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_can_write','unknown_membership']);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:113, confirm:false })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_can_write']);
});

void test('executor inspection fails closed when the exact target chat was not verified', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTargetVerification123');
  await assert.rejects(() => applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:candidate.version, requireTargetVerification:true,
    result:{status:'inspected', accessible:true, membershipState:'joined', observedName:'Wrong or unknown chat', chatType:'group', memberCount:900, topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active'},
  }, 110), error => error?.status === 409 && /цільовий чат/i.test(error.message));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'to_join');
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'not_checked');
});

void test('inspection cannot overwrite canonical joined membership with a stale manual state', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectMembershipCanonical123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Graz батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(joined.decision, 'target');

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  await assert.rejects(
    () => applyDiscoveryInspection(db, 'u', {
      candidateId: stored.id,
      expectedVersion: stored.version,
      result: { status:'inspected', targetVerified:true, membershipState:'not_checked' },
    }, 111),
    error => error?.status === 409 && /фактичному стану чату/i.test(error.message),
  );

  const after = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(after.membershipState, 'joined');
  assert.equal(after.decision, 'target');
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('inspection cannot fake an external leave for an imported chat', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectCannotFakeLeave123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Wien батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(joined.decision, 'target');

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  await assert.rejects(
    () => applyDiscoveryInspection(db, 'u', {
      candidateId: stored.id,
      expectedVersion: stored.version,
      result: { status:'inspected', targetVerified:true, membershipState:'left' },
    }, 111),
    error => error?.status === 409 && /leave-checklist/i.test(error.message),
  );

  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'target');
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'ready');
});

void test('confirmed external leave downgrades a target back to review', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectTargetLeave123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Завершено' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'review');
  assert.deepEqual(stored.reasonCodes, ['unknown_membership']);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:left, now:113, confirm:false })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'target');
  assert.deepEqual(stored.reasonCodes, ['all_required_confirmed']);
});

void test('joining removes only the membership blocker and preserves other qualification gaps', async (t) => {
  const { db, candidate: handed } = await importedCandidate(t, 'JoinKeepsOtherGaps123');
  let candidate = handed;
  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', accessible:true,
      observedName:'Українці Berlin батьки', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:null, adsPolicy:'unknown', activityState:'active',
    },
  }, 102);
  assert.equal(inspected.decision, 'review');
  assert.deepEqual(inspected.reasonCodes, ['unknown_can_write','unknown_membership']);

  candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  const toJoin = await readChatState(db, 'u', candidate.importedChatId);
  assert.ok(toJoin);
  assert.equal((await transitionChat(db, { userId:'u', chat:toJoin, action:'joined', accountId:null, now:104 })).ok, true);

  candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(candidate.membershipState, 'joined');
  assert.equal(candidate.decision, 'review');
  assert.deepEqual(candidate.reasonCodes, ['unknown_can_write']);
});

void test('restoring an archived discovery chat resets membership instead of reviving target status', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectRestoreMembership123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'target');

  const ready = await readChatState(db, 'u', chatId);
  assert.ok(ready);
  assert.equal((await transitionChat(db, { userId:'u', chat:ready, action:'archive', accountId:null, now:111, reason:'Пауза' })).ok, true);
  const archived = await readChatState(db, 'u', chatId);
  assert.ok(archived);
  assert.equal((await changeChatLeave(db, { userId:'u', chat:archived, now:112, confirm:true })).ok, true);

  const left = await readChatState(db, 'u', chatId);
  assert.ok(left);
  assert.equal((await transitionChat(db, { userId:'u', chat:left, action:'restore', accountId:null, now:113 })).ok, true);

  let stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'not_checked');
  assert.equal(stored.inspectionState, 'not_checked');
  assert.equal(stored.linkState, 'unknown');
  assert.equal(stored.accessState, 'unknown');
  assert.equal(stored.memberCount, null);
  assert.equal(stored.decision, 'review');
  assert.ok(stored.reasonCodes.includes('unknown_membership'));
  assert.ok(stored.reasonCodes.includes('unknown_inspection'));
  assert.ok(stored.reasonCodes.includes('unknown_invite_validity'));
  assert.ok(stored.reasonCodes.includes('unknown_access'));
  assert.equal((await readChatState(db, 'u', chatId)).workflow_status, 'to_join');

  const toJoin = await readChatState(db, 'u', chatId);
  assert.ok(toJoin);
  assert.equal((await transitionChat(db, { userId:'u', chat:toJoin, action:'joined', accountId:null, now:114 })).ok, true);
  stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'joined');
  assert.equal(stored.decision, 'review');
  assert.equal(stored.reasonCodes.includes('unknown_membership'), false);
  assert.ok(stored.reasonCodes.includes('unknown_inspection'));

  const inspected = await applyDiscoveryInspection(db, 'u', {
    candidateId: stored.id,
    expectedVersion: stored.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 115);
  assert.equal(inspected.decision, 'target');
});

void test('joined inspection with unknown rules stays ready but explicitly needs qualification', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectReview123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:900,
      canWrite:null, adsPolicy:'unknown', activityState:'unknown',
    },
  }, 110);
  assert.equal(outcome.decision, 'review');
  assert.equal(outcome.workflowStatus, 'ready');
  assert.equal(outcome.needsQualification, true);
  assert.equal(outcome.needsExternalLeave, false);
  // The imported fixture already carries topicMatch 'match' and the inspection reports no topic, so the
  // topic stays known; the remaining unknown criteria still keep the chat in review.
  assert.ok(!outcome.reasonCodes.includes('unknown_topic_match'));
  assert.ok(outcome.reasonCodes.includes('unknown_can_write'));
  // Ad rules and activity are not criteria any more (operator decision 2026-10-02).
  assert.ok(!outcome.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(!outcome.reasonCodes.includes('unknown_activity'));
});

void test('verified executor inspection keeps unverified joined chats in review for the operator instead of leaving', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'StrictAutonomousReview123');
  assert.equal(candidate.topicMatch, 'match');

  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    requireTargetVerification: true,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'G22 ADMISSION PROCESS 2025', chatType:'group',
      canWrite:true, activityState:'active',
    },
  }, 110);

  // Unknown facts never trigger an automatic leave (operator decision 2026-10-02); the operator decides.
  assert.equal(outcome.decision, 'review');
  assert.equal(outcome.needsExternalLeave, false);
  assert.ok(outcome.reasonCodes.includes('unknown_member_count'));
  assert.ok(outcome.reasonCodes.includes('unknown_topic_match'));
  assert.ok(!outcome.reasonCodes.includes('unknown_ads_allowed'));
  assert.ok(outcome.reasonCodes.includes('qualification_unverified'));

  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.topicMatch, 'unknown');
  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  assert.notEqual(queue.tasks.find(item => item.candidateId === candidate.id)?.action, 'leave');
});

void test('inspection can record observed audience mismatch instead of trusting source inference', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectAudienceMismatch123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Прага community', chatType:'group', memberCount:900,
      topicMatch:'mismatch', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.ok(outcome.reasonCodes.includes('topic_mismatch'));
  assert.equal(outcome.needsExternalLeave, true);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.topicMatch, 'mismatch');
});

void test('joined rejected chat is not hidden before external leave succeeds', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'InspectReject123');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
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

void test('joined rejected Viber candidate can complete the canonical external-leave checklist', async (t) => {
  const db = await localDatabase(t);
  const handed = await confirmLocalDiscoveryPreview(db, 'u', {
    platform:'viber', link:'https://invite.viber.com/?g2=ViberReject123', name:'Українці Praha', sources:[],
  }, 100);
  const candidate = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.importedChatId === handed.chatId);
  assert.ok(candidate);
  assert.equal(candidate.platform, 'viber');
  const outcome = await applyDiscoveryInspection(db, 'u', {
    candidateId: candidate.id,
    expectedVersion: candidate.version,
    result: {
      status:'inspected', targetVerified:true, accessible:true, membershipState:'joined',
      observedName:'Українці Praha допомога', chatType:'group', memberCount:500,
      topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active',
    },
  }, 110);
  assert.equal(outcome.decision, 'rejected');
  assert.equal(outcome.needsExternalLeave, true);

  const ready = await readChatState(db, 'u', handed.chatId);
  assert.equal(ready.workflow_status, 'ready');
  const queue = await readDiscoveryExecutorQueue(db, 'u', 10);
  const task = queue.tasks.find(item => item.candidateId === candidate.id);
  assert.equal(task?.action, 'leave');
  assert.equal(task?.platform, 'viber');
  assert.equal(task?.resultAction, 'executor-leave');
  assert.ok(task);
  const completed = await completeDiscoveryExternalLeave(db, 'u', {
    candidateId: task.candidateId,
    expectedVersion: task.candidateVersion,
    chatStateToken: task.chatStateToken,
    targetVerified: true,
  }, 112);
  assert.equal(completed.ok, true);

  const left = await readChatState(db, 'u', handed.chatId);
  assert.equal(left.workflow_status, 'archived');
  assert.equal(left.left_at, 112);
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.membershipState, 'left');
  assert.equal(stored.decision, 'rejected');
});

void test('external leave refuses an unverified target even with a fresh state token', async (t) => {
  const { db, candidate, chatId } = await importedCandidate(t, 'LeaveTargetVerification123');
  const joined = await applyDiscoveryInspection(db, 'u', {
    candidateId:candidate.id, expectedVersion:candidate.version,
    result:{status:'inspected', targetVerified:true, accessible:true, membershipState:'joined', observedName:'Українці Praha допомога', chatType:'group', memberCount:500, topicMatch:'match', canWrite:true, adsPolicy:'allowed', activityState:'active'},
  }, 110);
  assert.equal(joined.needsExternalLeave, true);
  const task = (await readDiscoveryExecutorQueue(db, 'u', 10)).tasks.find(item => item.candidateId === candidate.id);
  assert.ok(task);
  await assert.rejects(() => completeDiscoveryExternalLeave(db, 'u', {candidateId:task.candidateId, expectedVersion:task.candidateVersion, chatStateToken:task.chatStateToken, targetVerified:false}, 111), error => error?.status === 409 && /цільовий чат/i.test(error.message));
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
  const stored = (await readDiscoveryWorkspace(db, 'u')).candidates.find(item => item.id === candidate.id);
  assert.equal(stored.decision, 'unavailable');
  assert.equal(stored.inspectionState, 'failed');
  assert.equal(stored.linkState, 'invalid');
});

void test('inspection is owner scoped and optimistic', async (t) => {
  const { db, candidate } = await importedCandidate(t, 'InspectGuard123');
  await assert.rejects(
    applyDiscoveryInspection(db, 'other', {
      candidateId:candidate.id, expectedVersion:candidate.version,
      result:{status:'pending',targetVerified:true,accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат не знайдений/,
  );
  await assert.rejects(
    applyDiscoveryInspection(db, 'u', {
      candidateId:candidate.id, expectedVersion:candidate.version + 1,
      result:{status:'pending',targetVerified:true,accessible:true,membershipState:'pending'},
    }, 110),
    /Кандидат уже змінився/,
  );
});

