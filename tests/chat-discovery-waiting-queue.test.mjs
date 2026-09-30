import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDiscoveryExecutorQueue, readWaitingWhatsAppCheckStatus, startWaitingWhatsAppCheck } from '../lib/chat-discovery/executor.ts';
import { localDatabase } from './helpers/local-d1.mjs';

async function waitingChat(db, id, link) {
  await db.prepare(`INSERT INTO chats(
    id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at
  ) VALUES (?1,'u','whatsapp','Українці ' || ?1,?2,?2,'waiting',0,100,100)`).bind(id, link).run();
}

void test('archived chat with a stale batch marker cannot keep the Waiting batch active or block live rows', async (t) => {
  const db = await localDatabase(t);
  await waitingChat(db, 'stale', 'https://chat.whatsapp.com/StaleMarker123');
  await waitingChat(db, 'live', 'https://chat.whatsapp.com/LiveMarker123');
  const started = await startWaitingWhatsAppCheck(db, 'u', 200);
  assert.equal(started.queued, 2);

  await db.prepare(`UPDATE chats SET workflow_status='archived',archived_at=201,updated_at=201 WHERE id='stale'`).run();

  assert.deepEqual(await readWaitingWhatsAppCheckStatus(db, 'u'), { active: true, remaining: 1, batchId: 200 });
  const claimed = await claimDiscoveryExecutorQueue(db, 'u', 'device-a', 1, 210);
  assert.equal(claimed.tasks.length, 1);
  assert.equal(claimed.tasks[0].chatId, 'live');
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
