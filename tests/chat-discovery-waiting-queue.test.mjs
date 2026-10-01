import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import {
  claimWaitingWhatsAppCheck,
  completeWaitingWhatsAppCheck,
  readWaitingWhatsAppCheckStatus,
  releaseWaitingWhatsAppCheck,
  startWaitingWhatsAppCheck,
} from '../lib/chats/whatsapp-waiting-check.ts';
import { classifyWhatsAppSnapshot, toWaitingCheckOutcome } from '../scripts/whatsapp-web-cdp.mjs';
import { localDatabase } from './helpers/local-d1.mjs';

async function chat(db, id, { status = 'waiting', platform = 'whatsapp', snoozedUntil = null, updatedAt = 100 } = {}) {
  const link = `https://chat.whatsapp.com/${id.replace(/[^A-Za-z0-9]/g, '')}Invite123`;
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,snoozed_until,created_at,updated_at
  ) VALUES (?1,'u',?2,'Українці ' || ?1,?3,?3,?4,0,?5,?6,?6)`).bind(id, platform, link, status, snoozedUntil, updatedAt).run();
}

async function chatRow(db, id) {
  return db.prepare(`SELECT workflow_status,snoozed_until,joined_at FROM chats WHERE id=?1`).bind(id).first();
}

async function checkNext(db, status, now, extra = {}) {
  const task = await claimWaitingWhatsAppCheck(db, 'u', 'device-a', now);
  assert.ok(task, 'expected a waiting-check task');
  await completeWaitingWhatsAppCheck(db, 'u', 'device-a', { batchId: task.batchId, chatId: task.chatId, status, ...extra }, now + 1);
  return task;
}

void test('waiting check snapshots only due WhatsApp Waiting chats and creates no Discovery candidates', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'due-a', { updatedAt: 100 });
  await chat(db, 'due-b', { updatedAt: 101 });
  await chat(db, 'snoozed', { snoozedUntil: 10_000 });
  await chat(db, 'ready', { status: 'ready' });
  await chat(db, 'telegram', { platform: 'telegram' });

  const started = await startWaitingWhatsAppCheck(db, 'u', 200);
  assert.equal(started.active, true);
  assert.equal(started.total, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chat_discovery_candidates').first()).n, 0);
  assert.equal((await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 200)).tasks.length, 0);

  const first = await claimWaitingWhatsAppCheck(db, 'u', 'device-a', 201);
  assert.equal(first.chatId, 'due-a');
  assert.equal(first.kind, 'whatsapp_waiting_check');
});

void test('factual outcomes follow Prototype Checker: joined is approved, pending and requested wait three days', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'a', { updatedAt: 100 });
  await chat(db, 'b', { updatedAt: 101 });
  await chat(db, 'c', { updatedAt: 102 });
  await startWaitingWhatsAppCheck(db, 'u', 200);

  await checkNext(db, 'joined', 210);
  await checkNext(db, 'pending', 220);
  await checkNext(db, 'requested', 230);

  assert.equal((await chatRow(db, 'a')).workflow_status, 'ready');
  assert.ok((await chatRow(db, 'a')).joined_at);
  assert.equal((await chatRow(db, 'b')).workflow_status, 'waiting');
  assert.ok((await chatRow(db, 'b')).snoozed_until > 221);
  assert.ok((await chatRow(db, 'c')).snoozed_until > 231);

  const status = await readWaitingWhatsAppCheckStatus(db, 'u');
  assert.equal(status.active, false);
  assert.deepEqual(status.counts, { joined: 1, pending: 1, requested: 1, failed: 0, skipped: 0 });
  assert.equal(status.stopReason, null);
});

void test('a failed chat is reported and the batch moves on instead of blocking the queue', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'broken', { updatedAt: 100 });
  await chat(db, 'fine', { updatedAt: 101 });
  await startWaitingWhatsAppCheck(db, 'u', 200);

  await checkNext(db, 'failed', 210, { reason: 'invalid_whatsapp_link' });
  const next = await checkNext(db, 'joined', 220);
  assert.equal(next.chatId, 'fine');
  assert.equal((await chatRow(db, 'broken')).workflow_status, 'waiting');

  const status = await readWaitingWhatsAppCheckStatus(db, 'u');
  assert.equal(status.counts.failed, 1);
  assert.deepEqual(status.problems.map(item => item.reason), ['invalid_whatsapp_link']);
});

void test('retrying problems re-checks only the chats the previous batch reported', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'broken', { updatedAt: 100 });
  await chat(db, 'fine', { updatedAt: 101 });
  await chat(db, 'other', { updatedAt: 102 });
  await startWaitingWhatsAppCheck(db, 'u', 200);
  await checkNext(db, 'failed', 210, { reason: 'membership_not_confirmed' });
  await checkNext(db, 'requested', 220);
  await checkNext(db, 'pending', 230);

  const retried = await startWaitingWhatsAppCheck(db, 'u', 400, { onlyProblems: true });
  assert.equal(retried.total, 1);
  assert.equal((await checkNext(db, 'joined', 410)).chatId, 'broken');
  assert.equal((await readWaitingWhatsAppCheckStatus(db, 'u')).active, false);
});

void test('three failures in a row or a fatal reason stop the batch and leave the rest untouched', async (t) => {
  const db = await localDatabase(t);
  for (const id of ['f1', 'f2', 'f3', 'rest']) await chat(db, id);
  await startWaitingWhatsAppCheck(db, 'u', 200);
  for (let index = 0; index < 3; index += 1) await checkNext(db, 'failed', 210 + index * 10, { reason: 'membership_not_confirmed' });
  const stopped = await readWaitingWhatsAppCheckStatus(db, 'u');
  assert.equal(stopped.active, false);
  assert.match(stopped.stopReason, /3 помилки поспіль/);
  assert.equal(await claimWaitingWhatsAppCheck(db, 'u', 'device-a', 300), null);
  assert.equal((await chatRow(db, 'rest')).snoozed_until, null);

  const fresh = await localDatabase(t);
  await chat(fresh, 'x');
  await chat(fresh, 'y');
  await startWaitingWhatsAppCheck(fresh, 'u', 200);
  await checkNext(fresh, 'failed', 210, { reason: 'stale_overlay_not_dismissed' });
  assert.equal((await readWaitingWhatsAppCheckStatus(fresh, 'u')).active, false);
});

void test('a chat is leased to one device, re-issued after the lease, and released without counting a failure', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'only');
  await startWaitingWhatsAppCheck(db, 'u', 200);

  const claimed = await claimWaitingWhatsAppCheck(db, 'u', 'device-a', 201);
  assert.equal(await claimWaitingWhatsAppCheck(db, 'u', 'device-b', 202), null);
  const reissued = await claimWaitingWhatsAppCheck(db, 'u', 'device-b', claimed.leaseExpiresAt + 1);
  assert.equal(reissued.chatId, 'only');
  await assert.rejects(completeWaitingWhatsAppCheck(db, 'u', 'device-a', {
    batchId: claimed.batchId, chatId: 'only', status: 'joined',
  }, claimed.leaseExpiresAt + 2));

  assert.deepEqual(await releaseWaitingWhatsAppCheck(db, 'u', 'device-b', { batchId: reissued.batchId, chatId: 'only' }, claimed.leaseExpiresAt + 3), { ok: true });
  const status = await readWaitingWhatsAppCheckStatus(db, 'u');
  assert.equal(status.active, true);
  assert.equal(status.remaining, 1);
  assert.equal(status.counts.failed, 0);
});

void test('an operator action during the check wins over the runner result', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'manual');
  await startWaitingWhatsAppCheck(db, 'u', 200);
  const task = await claimWaitingWhatsAppCheck(db, 'u', 'device-a', 201);
  await db.prepare(`UPDATE chats SET workflow_status='archived',archived_at=202,updated_at=202 WHERE id='manual'`).run();
  const result = await completeWaitingWhatsAppCheck(db, 'u', 'device-a', { batchId: task.batchId, chatId: 'manual', status: 'joined' }, 203);
  assert.equal(result.applied, 'skipped');
  assert.equal((await chatRow(db, 'manual')).workflow_status, 'archived');
});

void test('retired waiting-* candidate rows can no longer trigger automated inspection or leave', async (t) => {
  const db = await localDatabase(t);
  await chat(db, 'approved', { status: 'ready' });
  await db.prepare(`UPDATE chats SET joined_at=150 WHERE id='approved'`).run();
  await db.prepare(`INSERT INTO chat_discovery_candidates(
    id,user_id,platform,name,link,normalized_link,discovered_at,membership_state,inspection_state,decision,
    reason_codes_json,imported_chat_id,created_at,updated_at
  ) SELECT 'waiting-approved','u','whatsapp',name,link,normalized_link,100,'joined','inspected','rejected','[]','approved',100,100
    FROM chats WHERE id='approved'`).run();
  assert.equal((await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 10_000)).tasks.length, 0);
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

  assert.equal((await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 200)).tasks.length, 1);
  await db.prepare(`UPDATE chat_discovery_candidates SET checked_at=200,updated_at=200,version=version+1 WHERE id='cand-pace'`).run();

  assert.equal((await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 201)).tasks.length, 0);
  assert.equal((await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 200 + 300)).tasks.length, 1);
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

void test('waiting check presses Request to join or Join like Prototype Checker; Discovery join stays fail-closed', () => {
  const request = classifyWhatsAppSnapshot(waitingTask, invitePage({ buttons: ['Request to join'], bodyText: 'Request to join' }));
  assert.equal(request.kind, 'action');
  assert.equal(request.action, 'request');
  const join = classifyWhatsAppSnapshot(waitingTask, invitePage({ buttons: ['Join group'], bodyText: 'Join group' }));
  assert.equal(join.kind, 'action');
  assert.equal(join.action, 'join');
  const pending = classifyWhatsAppSnapshot(waitingTask, invitePage({ bodyText: 'Request to join sent' }));
  assert.equal(pending.result.membershipState, 'pending');

  const discovery = classifyWhatsAppSnapshot({ ...waitingTask, action: 'join_and_inspect' }, invitePage({ buttons: ['Request to join'], bodyText: 'Request to join' }));
  assert.equal(discovery.result.reason, 'approval_required');
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
