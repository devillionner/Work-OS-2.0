import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessengerAutomationError,
  claimWhatsAppAutopostJob,
  completeWhatsAppAutopostJob,
  createWhatsAppAutopostBatch,
  createWhatsAppAutopostJob,
  cancelWhatsAppAutopostBatch,
  cancelWhatsAppAutopostJob,
  readLatestWhatsAppAutopostJob,
  releaseWhatsAppAutopostJob,
} from '../lib/messenger-automation.ts';
import { undoManualPublication, recordManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { chatListPageStatement } from '../lib/chats/list-query.ts';
import { OwnerChannel } from '../workers/owner-channel.js';

const NOW = Date.parse('2026-09-24T12:00:00Z') / 1000;
const DATE = '2026-09-24';

async function seedAdvertisement(db, id = 'ad') {
  await db.prepare(`INSERT INTO library_items
    (id,user_id,kind,collection,version,title,uk_text,ru_text,tags_json,platforms_json,created_at,updated_at)
    VALUES (?1,'u','advertisement','advertisement',3,'WA ad','Тест WhatsApp','Тест WhatsApp RU','[]','["whatsapp"]',1,1)`)
    .bind(id).run();
}

async function seedDevice(db, id = 'device') {
  await db.prepare(`INSERT INTO chat_discovery_executor_devices(id,user_id,name,token_hash,created_at)
    VALUES (?1,'u','Device',?2,1)`).bind(id, 'hash-' + id).run();
}

async function setupChat(db, suffix = 'concurrency', name = 'Українці Berlin') {
  await seedChat(db, { id: 'chat-' + suffix, owner: 'u', platform: 'whatsapp', status: 'ready', joined: 10, profile: true });
  await db.prepare(`UPDATE chats SET name=?1,link=?2,normalized_link=?2 WHERE id=?3`)
    .bind(name, `https://chat.whatsapp.com/Autopost${suffix}123`, `chat-${suffix}`).run();
  await seedAdvertisement(db, 'ad-' + suffix);
  return readChatState(db, 'u', `chat-${suffix}`);
}

function mockOwnerChannelEnv(db) {
  const stored = new Map();
  const sockets = [];
  const broadcasts = [];
  return {
    env: { DB: db },
    ctx: {
      storage: {
        get: async (key) => stored.get(key),
        put: async (key, val) => { stored.set(key, val); },
      },
      acceptWebSocket(ws, tags = []) { sockets.push({ ws, tags }); },
      getWebSockets(tag) { return sockets.filter(s => !tag || s.tags.includes(tag)).map(s => s.ws); },
      getTags(ws) { return sockets.find(s => s.ws === ws)?.tags ?? []; },
      setWebSocketAutoResponse() {},
    },
    broadcasts,
  };
}

void test('sequential repeated completion calls for the same job do not double-write publications or corrupt state', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'seq');
  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_seq_idempotency',
    chatId: chat.id,
  }, NOW, DATE);

  const task = await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  assert.ok(task);
  assert.equal(task.jobId, job.id);

  // 1st completion call: confirmed send succeeds
  const firstCompleted = await completeWhatsAppAutopostJob(db, 'u', {
    jobId: job.id,
    status: 'sent',
    observedTarget: 'Українці Berlin',
    targetVerified: true,
    sendConfirmed: true,
  }, NOW + 2);

  assert.equal(firstCompleted.ok, true);
  assert.equal(firstCompleted.status, 'sent');
  assert.ok(firstCompleted.publicationId);

  // Assert D1 publication count is 1
  const countAfterFirst = await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)');
  assert.equal(countAfterFirst, 1);

  // Assert activity_events count is 1
  const eventsAfterFirst = await db.prepare(
    `SELECT COUNT(*) FROM activity_events WHERE user_id='u' AND event_type='publication' AND cancelled_at IS NULL`
  ).first('COUNT(*)');
  assert.equal(eventsAfterFirst, 1);

  // 2nd completion call: sequential retry with same payload
  // CompleteWhatsAppAutopostJob checks row.status === 'claimed'. Since it is now 'sent',
  // it must reject with 409 fail-closed without corrupting state or adding duplicate records.
  await assert.rejects(
    completeWhatsAppAutopostJob(db, 'u', {
      jobId: job.id,
      status: 'sent',
      observedTarget: 'Українці Berlin',
      targetVerified: true,
      sendConfirmed: true,
    }, NOW + 3),
    (err) => err instanceof MessengerAutomationError && err.status === 409,
  );

  // Verify that D1 publication count remains strictly 1
  const countAfterSecond = await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)');
  assert.equal(countAfterSecond, 1);

  // Verify activity_events remains strictly 1
  const eventsAfterSecond = await db.prepare(
    `SELECT COUNT(*) FROM activity_events WHERE user_id='u' AND event_type='publication' AND cancelled_at IS NULL`
  ).first('COUNT(*)');
  assert.equal(eventsAfterSecond, 1);

  // Verify job state remains 'sent' with same publicationId
  const jobRow = await readLatestWhatsAppAutopostJob(db, 'u');
  assert.equal(jobRow?.status, 'sent');
  assert.equal(jobRow?.publicationId, firstCompleted.publicationId);
});

void test('concurrent completion calls for the same job resolve safely with exactly one publication written', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'conc');
  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_conc_idempotency',
    chatId: chat.id,
  }, NOW, DATE);

  const task = await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  assert.ok(task);
  assert.equal(task.jobId, job.id);

  // Launch 5 concurrent completion calls
  const promises = Array.from({ length: 5 }, (_, i) =>
    completeWhatsAppAutopostJob(db, 'u', {
      jobId: job.id,
      status: 'sent',
      observedTarget: '\u200eУкраїнці Berlin\u200e', // with bidi mark
      targetVerified: true,
      sendConfirmed: true,
    }, NOW + 2 + i)
  );

  const results = await Promise.allSettled(promises);

  // Check outcomes: at least one fulfilled, and every fulfilled returns status: 'sent'
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.ok(fulfilled.length >= 1, 'At least one concurrent completion must succeed');
  for (const f of fulfilled) {
    assert.equal(f.value.ok, true);
    assert.equal(f.value.status, 'sent');
    assert.ok(f.value.publicationId);
  }

  for (const r of rejected) {
    assert.ok(r.reason instanceof MessengerAutomationError);
    assert.equal(r.reason.status, 409);
  }

  // CRITICAL: D1 state check — exactly one publication in chat_publications
  const pubCount = await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)');
  assert.equal(pubCount, 1, 'chat_publications must contain exactly one row');

  // CRITICAL: activity_events count — exactly 1 publication event
  const eventCount = await db.prepare(
    `SELECT COUNT(*) FROM activity_events WHERE user_id='u' AND event_type='publication' AND cancelled_at IS NULL`
  ).first('COUNT(*)');
  assert.equal(eventCount, 1, 'activity_events must contain exactly one publication record');

  // CRITICAL: Job row status in D1 is 'sent'
  const finalJob = await readLatestWhatsAppAutopostJob(db, 'u');
  assert.equal(finalJob?.status, 'sent');
  assert.ok(finalJob?.publicationId);
});

void test('OwnerChannel gracefully handles duplicate or stale completion results without duplicate broadcasts', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'channel');
  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_channel_dup',
    chatId: chat.id,
  }, NOW, DATE);

  const task = await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  assert.ok(task);

  const { env, ctx } = mockOwnerChannelEnv(db);
  const channel = new OwnerChannel(ctx, env);

  // Simulate initial state where OwnerChannel is tracking job.id as autopostCurrentJobId
  await ctx.storage.put('state', {
    userId: 'u',
    processes: {},
    waitingCheckBatch: null,
    autopostCurrentJobId: job.id,
    discoveryCurrentTask: null,
    runnerLastSeenAt: NOW,
    runnerOnline: true,
  });

  const sentBroadcasts = [];
  channel.broadcast = (audience, payload) => {
    sentBroadcasts.push({ audience, payload });
  };

  // 1st result message from runner
  await channel.handleAutopostResult({
    type: 'result',
    process: 'autopost',
    jobId: job.id,
    status: 'sent',
    observedTarget: 'Українці Berlin',
    targetVerified: true,
    sendConfirmed: true,
  });

  // Verify first broadcastDerivation sent status: 'sent'
  assert.equal(sentBroadcasts.length, 1);
  assert.equal(sentBroadcasts[0].audience, 'browser');
  assert.equal(sentBroadcasts[0].payload.jobId, job.id);
  assert.equal(sentBroadcasts[0].payload.status, 'sent');

  // Verify publication written in D1
  assert.equal(await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)'), 1);

  // 2nd duplicate result message from runner arrives
  await channel.handleAutopostResult({
    type: 'result',
    process: 'autopost',
    jobId: job.id,
    status: 'sent',
    observedTarget: 'Українці Berlin',
    targetVerified: true,
    sendConfirmed: true,
  });

  // Verify OwnerChannel ignored the duplicate because state.autopostCurrentJobId was cleared to null
  // No second broadcast should have been dispatched for this job
  assert.equal(sentBroadcasts.length, 1);

  // Publication count remains 1
  assert.equal(await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)'), 1);
});

void test('cancelled batch fences off late runner completion results with zero publications written', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);

  for (const s of ['c1', 'c2']) {
    await setupChat(db, s, `Чат ${s.toUpperCase()}`);
  }

  const batch = await createWhatsAppAutopostBatch(db, 'u', { limit: 10 }, NOW, DATE);
  assert.equal(batch.created, 2);

  const claimedTask = await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  assert.ok(claimedTask);

  // Operator cancels today's autopost batch
  const cancelResult = await cancelWhatsAppAutopostBatch(db, 'u', DATE, NOW + 2);
  assert.equal(cancelResult.cancelled, 2);

  // Runner reports late send confirmation for claimedTask
  await assert.rejects(
    completeWhatsAppAutopostJob(db, 'u', {
      jobId: claimedTask.jobId,
      status: 'sent',
      observedTarget: claimedTask.target.expectedName,
      targetVerified: true,
      sendConfirmed: true,
    }, NOW + 3),
    (err) => err instanceof MessengerAutomationError && err.status === 409,
  );

  // Assert chat_publications remains completely empty
  const totalPubs = await db.prepare(`SELECT COUNT(*) FROM chat_publications WHERE user_id='u'`).first('COUNT(*)');
  assert.equal(totalPubs, 0);

  // Assert activity_events remains empty
  const totalEvents = await db.prepare(`SELECT COUNT(*) FROM activity_events WHERE event_type='publication'`).first('COUNT(*)');
  assert.equal(totalEvents, 0);

  // Assert all batch jobs are marked 'cancelled'
  const pendingOrClaimed = await db.prepare(
    `SELECT COUNT(*) FROM whatsapp_autopost_jobs WHERE user_id='u' AND status IN ('pending', 'claimed')`
  ).first('COUNT(*)');
  assert.equal(pendingOrClaimed, 0);
});

void test('released/stale job cannot be completed by prior runner without active claim', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'stale');
  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_stale_claim',
    chatId: chat.id,
  }, NOW, DATE);

  // Claim 1
  const claim1 = await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  assert.ok(claim1);

  // Runner disconnects -> release job back to pending
  const released = await releaseWhatsAppAutopostJob(db, 'u', job.id, NOW + 2);
  assert.equal(released, true);

  // Old runner tries to complete
  await assert.rejects(
    completeWhatsAppAutopostJob(db, 'u', {
      jobId: job.id,
      status: 'sent',
      observedTarget: chat.name,
      targetVerified: true,
      sendConfirmed: true,
    }, NOW + 3),
    (err) => err instanceof MessengerAutomationError && err.status === 409,
  );
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'), 0);

  // New runner claims the pending job
  const claim2 = await claimWhatsAppAutopostJob(db, 'u', NOW + 4);
  assert.ok(claim2);
  assert.equal(claim2.jobId, job.id);

  // New runner completes
  const completed2 = await completeWhatsAppAutopostJob(db, 'u', {
    jobId: job.id,
    status: 'sent',
    observedTarget: chat.name,
    targetVerified: true,
    sendConfirmed: true,
  }, NOW + 5);
  assert.equal(completed2.ok, true);
  assert.equal(completed2.status, 'sent');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'), 1);
});

void test('chats.published_today strictly reflects chat_publications under creation, isolation, and undo', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat1 = await setupChat(db, 'pub1', 'Чат Перший');
  const chat2 = await setupChat(db, 'pub2', 'Чат Другий');

  // Step 1: Baseline check — no publications exist
  const directPubChat1 = await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2) AS published_today`
  ).bind(chat1.id, DATE).first('published_today');
  assert.equal(directPubChat1, 0);

  let page = await chatListPageStatement(db, {
    userId: 'u', platform: 'whatsapp', status: 'ready', needsReview: false,
    today: DATE, now: NOW, offset: 0, accountId: null,
  }).all();
  assert.equal(page.results.find(r => r.id === chat1.id)?.published_today, 0);
  assert.equal(page.results.find(r => r.id === chat2.id)?.published_today, 0);

  // Step 2: Autopost job for chat1 is confirmed and sent
  const job1 = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_pub_chat1',
    chatId: chat1.id,
  }, NOW, DATE);
  await claimWhatsAppAutopostJob(db, 'u', NOW + 1);
  const completed1 = await completeWhatsAppAutopostJob(db, 'u', {
    jobId: job1.id,
    status: 'sent',
    observedTarget: chat1.name,
    targetVerified: true,
    sendConfirmed: true,
  }, NOW + 2);
  assert.equal(completed1.status, 'sent');

  // Step 3: Verify published_today reflects 1 for chat1 and 0 for chat2
  const directAfterPub1 = await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2) AS published_today`
  ).bind(chat1.id, DATE).first('published_today');
  assert.equal(directAfterPub1, 1);

  page = await chatListPageStatement(db, {
    userId: 'u', platform: 'whatsapp', status: 'ready', needsReview: false,
    today: DATE, now: NOW + 3, offset: 0, accountId: null,
  }).all();
  assert.equal(page.results.find(r => r.id === chat1.id)?.published_today, 1);
  assert.equal(page.results.find(r => r.id === chat2.id)?.published_today, 0);

  // Step 4: Verify date isolation — querying for tomorrow's date returns published_today = 0
  const TOMORROW = '2026-09-25';
  const directTomorrow = await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2) AS published_today`
  ).bind(chat1.id, TOMORROW).first('published_today');
  assert.equal(directTomorrow, 0);

  const tomorrowPage = await chatListPageStatement(db, {
    userId: 'u', platform: 'whatsapp', status: 'ready', needsReview: false,
    today: TOMORROW, now: NOW + 86400, offset: 0, accountId: null,
  }).all();
  assert.equal(tomorrowPage.results.find(r => r.id === chat1.id)?.published_today, 0);

  // Step 5: Manual publication in chat2 also updates published_today to 1
  const manual = await recordManualPublication(db, {
    userId: 'u', chat: chat2, accountId: null, advertisementId: 'ad-pub2',
    language: 'uk', quickMode: true, now: NOW + 4, date: DATE, stateToken: chat2.state_token,
  });
  assert.equal(manual.ok, true);

  page = await chatListPageStatement(db, {
    userId: 'u', platform: 'whatsapp', status: 'ready', needsReview: false,
    today: DATE, now: NOW + 5, offset: 0, accountId: null,
  }).all();
  assert.equal(page.results.find(r => r.id === chat1.id)?.published_today, 1);
  assert.equal(page.results.find(r => r.id === chat2.id)?.published_today, 1);

  // Step 6: Undoing manual publication in chat2 removes publication and reverts published_today to 0
  const refreshedChat2 = await readChatState(db, 'u', chat2.id);
  const undoResult = await undoManualPublication(db, {
    userId: 'u', chat: refreshedChat2, now: NOW + 6, date: DATE,
  });
  assert.equal(undoResult.ok, true);

  const directAfterUndo = await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2) AS published_today`
  ).bind(chat2.id, DATE).first('published_today');
  assert.equal(directAfterUndo, 0);

  page = await chatListPageStatement(db, {
    userId: 'u', platform: 'whatsapp', status: 'ready', needsReview: false,
    today: DATE, now: NOW + 7, offset: 0, accountId: null,
  }).all();
  assert.equal(page.results.find(r => r.id === chat1.id)?.published_today, 1);
  assert.equal(page.results.find(r => r.id === chat2.id)?.published_today, 0);
});

void test('concurrent race between operator cancel and runner complete resolves cleanly without split brain', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'race_cancel_complete');
  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_race_cancel',
    chatId: chat.id,
  }, NOW, DATE);

  await claimWhatsAppAutopostJob(db, 'u', NOW + 1);

  // Concurrently execute operator cancel and runner complete
  const [cancelRes, completeRes] = await Promise.allSettled([
    cancelWhatsAppAutopostJob(db, 'u', job.id, NOW + 2),
    completeWhatsAppAutopostJob(db, 'u', {
      jobId: job.id,
      status: 'sent',
      observedTarget: chat.name,
      targetVerified: true,
      sendConfirmed: true,
    }, NOW + 2),
  ]);

  const pubCount = await db.prepare(
    `SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id=?1 AND published_on=?2`
  ).bind(chat.id, DATE).first('COUNT(*)');
  const jobRow = await readLatestWhatsAppAutopostJob(db, 'u');

  if (cancelRes.status === 'fulfilled') {
    // If cancel won:
    if (completeRes.status === 'rejected') {
      // Complete was fenced off
      assert.equal(pubCount, 0);
      assert.equal(jobRow?.status, 'cancelled');
    } else {
      // Complete completed before or during cancel
      assert.equal(pubCount, 1);
      assert.equal(jobRow?.status, 'sent');
    }
  } else {
    // Cancel failed with 409 because complete already finalized
    assert.equal(completeRes.status, 'fulfilled');
    assert.equal(pubCount, 1);
    assert.equal(jobRow?.status, 'sent');
  }
});

void test('adversarial target variations with all bidi control characters match and empty/malicious names fail-close', async t => {
  const db = await localDatabase(t);
  await seedDevice(db);
  const chat = await setupChat(db, 'bidi_adv', 'Українська Спільнота');

  const job = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_adv_targets',
    chatId: chat.id,
  }, NOW, DATE);
  await claimWhatsAppAutopostJob(db, 'u', NOW + 1);

  // 1. Observed target wrapped in multiple bidi overrides: LRM \u200e, RLM \u200f, LRE \u202a, RLE \u202b, PDF \u202c, LRO \u202d, RLO \u202e
  const bidiAdversarial = '\u200e\u202a\u200fУкраїнська \u202c\u202dСпільнота\u202e\u200f';
  const completed = await completeWhatsAppAutopostJob(db, 'u', {
    jobId: job.id,
    status: 'sent',
    observedTarget: bidiAdversarial,
    targetVerified: true,
    sendConfirmed: true,
  }, NOW + 2);

  assert.equal(completed.ok, true);
  assert.equal(completed.status, 'sent');
  assert.ok(completed.publicationId);

  // 2. Job for another chat with empty/only-bidi target must fail closed with target_not_verified
  const chat2 = await setupChat(db, 'bidi_empty', 'Group');
  const job2 = await createWhatsAppAutopostJob(db, 'u', {
    requestKey: 'request_adv_empty',
    chatId: chat2.id,
  }, NOW, DATE);
  await claimWhatsAppAutopostJob(db, 'u', NOW + 1);

  const completedEmpty = await completeWhatsAppAutopostJob(db, 'u', {
    jobId: job2.id,
    status: 'sent',
    observedTarget: '\u200e\u200f\u202a\u202c', // only bidi characters -> normalizes to ''
    targetVerified: true,
    sendConfirmed: true,
  }, NOW + 2);

  assert.equal(completedEmpty.ok, true);
  assert.equal(completedEmpty.status, 'failed');
  assert.equal(completedEmpty.result.errorCode, 'target_not_verified');
  assert.equal(completedEmpty.publicationId, null);
});

