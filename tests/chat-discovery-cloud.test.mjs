import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continueDiscoveryRun,
  evaluateDiscoveryCandidate,
  handoffDiscoveryCandidate,
  readDiscoveryWorkspace,
  startDiscoveryRun,
} from '../lib/chat-discovery/domain.ts';
import { discoverPublicWeb, extractInviteRecords, safePublicUrl } from '../lib/chat-discovery/public-web.ts';
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
