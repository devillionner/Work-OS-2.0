import assert from 'node:assert/strict';
import test from 'node:test';

// The WhatsApp Waiting-check batch lifecycle (queue snapshot, lease-free dispatch, stop fencing,
// retry_problems, 3-strikes stop) moved into the owner Durable Object in commit 3b and is covered
// end-to-end there now — see tests/owner-channel.test.mjs. What remains here is unrelated to that
// batch state: the Discovery executor queue's own retired-row/pacing guards, and the pure WhatsApp
// Web CDP classification helpers.
import { readDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import { classifyWhatsAppSnapshot, toWaitingCheckOutcome } from '../scripts/whatsapp-web-cdp.mjs';
import { localDatabase } from './helpers/local-d1.mjs';

async function chat(db, id, { status = 'waiting', platform = 'whatsapp', snoozedUntil = null, updatedAt = 100 } = {}) {
  const link = `https://chat.whatsapp.com/${id.replace(/[^A-Za-z0-9]/g, '')}Invite123`;
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,snoozed_until,created_at,updated_at
  ) VALUES (?1,'u',?2,'Українці ' || ?1,?3,?3,?4,0,?5,?6,?6)`).bind(id, platform, link, status, snoozedUntil, updatedAt).run();
}

void test('retired waiting-* candidate rows can no longer trigger automated inspection or leave', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'approved', { status: 'ready' });
  await db.prepare(`UPDATE chats SET joined_at=150 WHERE id='approved'`).run();
  await db.prepare(`INSERT INTO chat_discovery_candidates(
    id,user_id,platform,name,link,normalized_link,discovered_at,membership_state,inspection_state,decision,
    reason_codes_json,imported_chat_id,created_at,updated_at
  ) SELECT 'waiting-approved','u','whatsapp',name,link,normalized_link,100,'joined','inspected','rejected','[]','approved',100,100
    FROM chats WHERE id='approved'`).run();
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 1, 10_000)).tasks.length, 0);
});

void test('an attempted not_checked candidate is paced instead of being re-claimed on the next poll', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at
  ) VALUES ('tj','u','whatsapp','Українці Brno','https://chat.whatsapp.com/PaceRetry123',
    'https://chat.whatsapp.com/PaceRetry123','to_join',0,100,100)`).run();
  await db.prepare(`INSERT INTO chat_discovery_candidates(
    id,user_id,platform,name,link,normalized_link,discovered_at,membership_state,inspection_state,decision,
    reason_codes_json,imported_chat_id,created_at,updated_at
  ) VALUES ('cand-pace','u','whatsapp','Українці Brno','https://chat.whatsapp.com/PaceRetry123',
    'https://chat.whatsapp.com/PaceRetry123',100,'not_checked','not_checked','review','[]','tj',100,100)`).run();

  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 1, 200)).tasks.length, 1);
  await db.prepare(`UPDATE chat_discovery_candidates SET checked_at=200,updated_at=200,version=version+1 WHERE id='cand-pace'`).run();

  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 1, 201)).tasks.length, 0);
  assert.equal((await readDiscoveryExecutorQueue(db, 'u', 1, 200 + 300)).tasks.length, 1);
});

const waitingTask = {
  action: 'waiting_check', platform: 'whatsapp', runtime: 'whatsapp_web', name: 'Українці Варшава',
  link: 'https://chat.whatsapp.com/AbCdEfGh1234',
  expectedTarget: { name: 'Українці Варшава', link: 'https://chat.whatsapp.com/AbCdEfGh1234' },
};
const invitePage = (extra) => ({
  url: 'https://web.whatsapp.com/accept?code=AbCdEfGh1234', navigatedInviteCode: 'AbCdEfGh1234',
  targetTexts: ['Українці Варшава'], headerTitles: [], buttons: [], bodyText: '', ...extra,
});

void test('waiting check and Discovery join both press Request to join or Join like Prototype Checker (operator decision 2026-10-05)', () => {
  const request = classifyWhatsAppSnapshot(waitingTask, invitePage({ buttons: ['Request to join'], bodyText: 'Request to join' }));
  assert.equal(request.kind, 'action');
  assert.equal(request.action, 'request');
  const join = classifyWhatsAppSnapshot(waitingTask, invitePage({ buttons: ['Join group'], bodyText: 'Join group' }));
  assert.equal(join.kind, 'action');
  assert.equal(join.action, 'join');
  const pending = classifyWhatsAppSnapshot(waitingTask, invitePage({ bodyText: 'Request to join sent' }));
  assert.equal(pending.result.membershipState, 'pending');

  // A Discovery candidate that already cleared member-count/topic/community gets the same request
  // sent, instead of being discarded the moment a chat turns out to need admin approval.
  const discovery = classifyWhatsAppSnapshot({ ...waitingTask, action: 'join_and_inspect' }, invitePage({ buttons: ['Request to join'], bodyText: 'Request to join' }));
  assert.equal(discovery.kind, 'action');
  assert.equal(discovery.action, 'request');
});

void test('browser outcomes map to waiting-check results; runtime problems are not chat failures', () => {
  const verified = { targetVerified: true, observedName: 'Українці Варшава' };
  assert.equal(toWaitingCheckOutcome({ kind: 'result', result: { ...verified, membershipState: 'joined' }, actions: [] }).status, 'joined');
  assert.equal(toWaitingCheckOutcome({ kind: 'result', result: { ...verified, membershipState: 'pending' }, actions: [] }).status, 'pending');
  assert.equal(toWaitingCheckOutcome({ kind: 'result', result: { ...verified, membershipState: 'pending' }, actions: ['request'] }).status, 'requested');
  assert.deepEqual(toWaitingCheckOutcome({ kind: 'result', result: { status: 'failed', reason: 'invalid_whatsapp_link' } }),
    { kind: 'result', status: 'failed', reason: 'invalid_whatsapp_link', observedName: undefined });
  assert.equal(toWaitingCheckOutcome({ kind: 'blocked', reason: 'membership_not_confirmed' }).status, 'failed');
  assert.deepEqual(toWaitingCheckOutcome({ kind: 'blocked', reason: 'whatsapp_not_authenticated' }), { kind: 'blocked', reason: 'whatsapp_not_authenticated' });
});
