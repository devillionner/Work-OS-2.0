import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichWaitingCheckProblems } from '../lib/chats/whatsapp-waiting-check.ts';
import { claimWhatsAppAutopostJob } from '../lib/messenger-automation.ts';
import { addSelectedChatToJoin, readSelectedChats, readSelectedChatsCount, saveSelectedChats } from '../lib/chats/telegram-selected.ts';
import { readSyncRevision } from '../lib/sync-revision.ts';
import { archiveLocalDiscoveryOutcomes, previewTelegramDiscoveryText, readDiscoveryTelegramGroupSources } from '../lib/chat-discovery/local-preview.ts';
import { enrichImportedChatNames } from '../lib/chats/name-enrichment.ts';
import { chatListPageStatement } from '../lib/chats/list-query.ts';
import { readDashboardSnapshot } from '../lib/dashboard-data.ts';
import { availableTodayStatement, publishedTodayStatement } from '../lib/chats/daily-links.ts';
import { readTelegramWarmup } from '../lib/chats/telegram-warmup.ts';
import { localDatabase } from './helpers/local-d1.mjs';

// Everything a runner or an open page polls on a timer must stay cheap in D1 rows read, whatever the
// owner's data size: a regression here once burned the daily D1 read quota in a few hours.
const CANDIDATES = 2000;
const NOW = 1_800_000_000;

function meter(db) {
  const usage = { rows: 0 };
  const count = result => { usage.rows += result?.meta?.rows_read || 0; return result; };
  const wrap = statement => {
    const wrapped = Object.create(statement);
    wrapped.bind = (...values) => wrap(statement.bind(...values));
    wrapped.all = async () => count(await statement.all());
    wrapped.run = async () => count(await statement.run());
    wrapped.first = async column => {
      const row = count(await statement.all()).results[0] ?? null;
      return column && row ? row[column] : row;
    };
    return wrapped;
  };
  const metered = new Proxy(db, { get(target, property) {
    if (property === 'prepare') return sql => wrap(target.prepare(sql));
    if (property === 'batch') return async statements => { const results = await target.batch(statements); results.forEach(count); return results; };
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { db: metered, async rows(action) { usage.rows = 0; await action(metered); return usage.rows; } };
}

async function seed(db) {
  const statements = [];
  for (let index = 0; index < CANDIDATES; index += 1) {
    const link = `https://chat.whatsapp.com/Budget${index}Invite`;
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u','whatsapp',?1,?2,?2,'waiting',0,1,?3)`).bind(`chat-${index}`, link, index));
    statements.push(db.prepare(`INSERT INTO chat_discovery_candidates(id,user_id,platform,name,link,normalized_link,discovered_at,created_at,updated_at,
      membership_state,inspection_state,decision,imported_chat_id,checked_at)
      VALUES (?1,'u','whatsapp',?1,?2,?2,1,1,?3,'joined','inspected','target',?4,?5)`).bind(`cand-${index}`, link, index, `chat-${index}`, NOW));
    if (statements.length >= 200) await db.batch(statements.splice(0));
  }
  if (statements.length) await db.batch(statements);
}

void test('idle runner polls stay within a fixed D1 row budget regardless of data size', async (t) => {
  const db = await localDatabase(t);
  await seed(db);
  const { rows } = meter(db);

  // Since commit 3b/3c/3d the WhatsApp Waiting-check, Autopost and Discovery runners all hold one
  // WebSocket to the owner's Durable Object instead of polling an HTTP endpoint on a timer, so there
  // is no D1-touching idle poll left to meter here for any of the three — a genuine zero, not merely
  // a bounded one. The DO still reads D1 when it actually has a reason to (a runner connects, a
  // result/ready arrives, an operator action wakes it) but that cost is bounded by real events, not
  // by a blind interval — see tests/owner-channel.test.mjs for that dispatch's own coverage.
  assert.ok(await rows(metered => claimWhatsAppAutopostJob(metered, 'u', NOW)) <= 5);
});

void test('page polls (sync revision, Waiting-check status, Telegram selected list) stay bounded', async (t) => {
  const db = await localDatabase(t);
  await seed(db);
  const { rows } = meter(db);
  assert.ok(await rows(metered => readSyncRevision(metered, 'u')) <= 2);
  // The browser's Waiting-check status poll goes to the owner Durable Object now (commit 3b), which
  // only reaches D1 at all to enrich a finished batch's problem list — bounded by how many problems
  // that one batch reported (<=30), never by the owner's total chat count.
  assert.ok(await rows(metered => enrichWaitingCheckProblems(metered, 'u', [], NOW)) === 0, 'no problems to enrich means no D1 read at all');
  const manyProblems = Array.from({ length: 30 }, (_, index) => ({ chatId: `chat-${index}`, name: `chat-${index}`, reason: 'whatsapp_join_retry_later' }));
  assert.ok(await rows(metered => enrichWaitingCheckProblems(metered, 'u', manyProblems, NOW)) <= 60, 'enriching a full problem list must use index lookups, not scan all chats');

  // Real owners have thousands of Telegram chats; the selected list must not scan them per link.
  const telegram = [];
  for (let index = 0; index < 3000; index += 1) {
    const link = `https://t.me/budget_chat_${index}`;
    telegram.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u','telegram',?1,?2,?2,'archived',0,1,?3)`).bind(`tg-${index}`, link, index));
    if (telegram.length >= 200) await db.batch(telegram.splice(0));
  }
  if (telegram.length) await db.batch(telegram);
  const items = Array.from({ length: 1000 }, (_, index) => ({ link: `https://t.me/budget_chat_${index * 2}`, title: `Чат ${index}`, count: index, last: null }));
  await saveSelectedChats(db, 'u', { items, skipped: 0 }, NOW);
  assert.ok(await rows(metered => readSelectedChatsCount(metered, 'u')) <= 2, 'the tab badge must not look up every chat');
  assert.ok(await rows(metered => readSelectedChats(metered, 'u')) <= items.length * 3, 'selected list must use index lookups, not scan all chats');
  await saveSelectedChats(db, 'u', { items: [...items, { link: 'https://t.me/budget_new_chat', title: 'Новий', count: 1, last: null }], skipped: 0 }, NOW);
  assert.ok(await rows(metered => addSelectedChatToJoin(metered, 'u', 'https://t.me/budget_new_chat', NOW)) <= 20, 'adding one selected chat must not scan all chats');
});

// Discovery since 2026-10-02: the Telegram-group list is read once per run start, every found invite is
// deduplicated against D1 (read only), and «Архівувати всі» writes up to 100 chats in one batch. None of them
// may grow with the owner's total candidates or chats.
void test('Discovery run start, invite dedupe and archive-all stay bounded in D1 rows', async (t) => {
  const db = await localDatabase(t);
  await seed(db);
  const { rows } = meter(db);
  const telegram = [];
  for (let index = 0; index < 3000; index += 1) {
    const link = `https://t.me/budget_group_${index}`;
    const joined = index < 300;
    telegram.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,joined_at,is_private,created_at,updated_at)
      VALUES (?1,'u','telegram',?1,?2,?2,?3,?4,0,1,?5)`).bind(`tgg-${index}`, link, joined ? 'ready' : 'archived', joined ? 1 : null, index));
    if (telegram.length >= 200) await db.batch(telegram.splice(0));
  }
  if (telegram.length) await db.batch(telegram);

  let groups;
  const startRows = await rows(async metered => { groups = await readDiscoveryTelegramGroupSources(metered, 'u'); });
  assert.equal(groups.groups.length, 300);
  assert.ok(startRows <= 300 + 5, `run start read ${startRows} rows; only the joined live Telegram chats may be read`);

  const dedupeRows = await rows(metered => previewTelegramDiscoveryText(metered, 'u', {
    text: 'Українці: https://chat.whatsapp.com/Budget1Invite https://chat.whatsapp.com/BudgetFreshInvite01',
    sourceUrl: 'https://t.me/budget_group_1', sourceTitle: 'Українці', query: 'Українці',
  }, NOW));
  assert.ok(dedupeRows <= 10, `invite dedupe read ${dedupeRows} rows; it must use index lookups`);

  const items = Array.from({ length: 100 }, (_, index) => ({
    platform: 'whatsapp', link: `https://chat.whatsapp.com/BudgetArchive${String(index).padStart(3, '0')}x`, name: `n${index}`,
    sources: [{ kind: 'telegram_global', sourceUrl: 'https://t.me/budget_group_1', sourceTitle: 'Українці', query: 'q', seedLabel: 'q', seedKind: 'telegram_chat', context: '' }],
    outcome: { decision: 'rejected', reasonCodes: ['too_few_members'], result: { memberCount: 10 } },
  }));
  const archiveRows = await rows(metered => archiveLocalDiscoveryOutcomes(metered, 'u', { items }, NOW));
  assert.ok(archiveRows > 0, "the metered batch must count archive rows");
  // Measured: a constant 12 rows per archived chat (unique-index and FK checks) whether the owner has 0 or 6 000 candidates.
  assert.ok(archiveRows <= items.length * 12, `archive-all read ${archiveRows} rows for ${items.length} chats`);

  // Name enrichment after an import looks each link up by (platform, link); it must not walk the owner's
  // 5 000 chats. (persistDiscoveryBatch's two lookups use the same CROSS JOIN form and are planned by
  // tests/d1-query-plan-audit.test.mjs.)
  const links = Array.from({ length: 20 }, (_, index) => `https://t.me/budget_missing_${index}`);
  const enrichRows = await rows(metered => enrichImportedChatNames(metered, 'u', links, NOW, async () => { throw new Error('no fetch expected'); }));
  assert.ok(enrichRows <= links.length + 5, `name enrichment lookup read ${enrichRows} rows for ${links.length} links`);
});

void test('Chat list page reads its own queue, not every chat of the owner', async (t) => {
  const db = await localDatabase(t);
  // Worst case for an updated_at walk: the requested WhatsApp queues are the oldest rows and 5 400 newer
  // chats belong to other statuses/platforms.
  const statements = [];
  for (let index = 0; index < 6000; index += 1) {
    const telegram = index >= 3000;
    const link = telegram ? `https://t.me/list_${index}` : `https://chat.whatsapp.com/List${index}`;
    const status = telegram ? 'archived' : index < 300 ? 'waiting' : index < 600 ? 'ready' : 'archived';
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u',?2,?1,?3,?3,?4,0,1,?5)`).bind(`list-${index}`, telegram ? 'telegram' : 'whatsapp', link, status, index));
    // Real chats carry a history; the per-chat subqueries (snooze count, leave, state token) read it.
    if (status !== 'archived') for (let event = 0; event < 4; event += 1) {
      statements.push(db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
        VALUES (?1,'u',?2,'whatsapp',?3,?4,'2027-01-15',?5,?1)`).bind(`list-${index}-e${event}`, event === 3 ? 'publication' : 'chat_state_changed', `list-${index}`, 1000 + event, JSON.stringify({ action: ['snooze', 'joined', 'approved'][event % 3] })));
    }
    if (statements.length >= 200) await db.batch(statements.splice(0));
  }
  if (statements.length) await db.batch(statements);
  const { rows } = meter(db);
  const page = status => rows(metered => chatListPageStatement(metered, { userId: 'u', platform: 'whatsapp', status, needsReview: false, today: '2027-01-15', now: NOW, offset: 0, accountId: null }).all());

  // Measured: 150 rows for a 50-row page without history (was ≈5 900 with the `?3='profile_review' OR …`
  // filter); with 4 history events per chat the per-chat subqueries add ≈9 rows for each of the 50.
  for (const status of ['waiting', 'ready']) {
    const read = await page(status);
    assert.ok(read <= 700, `${status} page read ${read} rows`);
  }
  // The review queue spans two statuses: each status arm stops after its first 50 rows and the per-chat
  // subqueries run for the 50 page rows only. Measured 800 rows; one sort over the whole queue, with the
  // subqueries evaluated for all 600 chats before it, read 3 903 here (≈3 400 per call on staging, d1
  // insights 2026-10-04).
  const review = await page('profile_review');
  assert.ok(review <= 1000, `profile_review page read ${review} rows`);
});

void test('Dashboard chat total comes from the queue counters, not a count over every chat', async (t) => {
  const db = await localDatabase(t);
  await seed(db);
  // One archived chat and one status move keep the trigger-maintained counters honest.
  await db.prepare(`UPDATE chats SET workflow_status='archived' WHERE id='chat-0'`).run();
  await db.prepare(`UPDATE chats SET workflow_status='ready' WHERE id='chat-1'`).run();
  const { rows } = meter(db);
  let snapshot;
  const read = await rows(async metered => { snapshot = await readDashboardSnapshot(metered, 'u', NOW); });
  const expected = await db.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id='u' AND workflow_status!='archived'`).first('count');
  assert.equal(snapshot.chats, expected);
  // Measured before: ≈2 000 rows for the chat count alone with 2 000 chats; now the whole snapshot stays small.
  console.log("DASH_ROWS", read);
  assert.ok(read <= 200, `dashboard snapshot read ${read} rows`);
});

void test('Telegram warmup reads only its own account, not every account of the owner', async (t) => {
  const db = await localDatabase(t);
  const ACCOUNTS = 5; const EVENTS_PER_ACCOUNT = 1000;
  const statements = [];
  for (let acct = 0; acct < ACCOUNTS; acct += 1) {
    statements.push(db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,created_at,updated_at)
      VALUES (?1,'u',?2,?1,1,1)`).bind(`tg-${acct}`, acct + 10));
    for (let index = 0; index < EVENTS_PER_ACCOUNT; index += 1) {
      const id = `warmup-${acct}-${index}`;
      statements.push(db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
        VALUES (?1,'u',?2,'telegram',?3,'2027-01-15','{}',?1,?4)`)
        .bind(id, index % 3 === 0 ? 'chat_joined' : 'publication', index, `tg-${acct}`));
      if (statements.length >= 200) await db.batch(statements.splice(0));
    }
  }
  if (statements.length) await db.batch(statements);
  const { rows } = meter(db);
  const read = await rows(metered => readTelegramWarmup(metered, 'u', 'tg-0'));
  // Measured before activity_events_user_account_type_idx: the (user_id) index prefix forced a walk of
  // every account's events (≈31 000 + 31 000 rows for the owner). Now it stays near one account's size.
  console.log("WARMUP_ROWS", read);
  assert.ok(read <= EVENTS_PER_ACCOUNT * 2, `warmup read ${read} rows for one account among ${ACCOUNTS}`);
});

void test('Published-today reads only its own platform, not every platform of the owner', async (t) => {
  const db = await localDatabase(t);
  // Lopsided on purpose: a busy decoy platform (telegram) and a quiet target platform (viber), like a
  // real owner who publishes to Telegram constantly but to Viber only a handful of times a day.
  const DECOY = 2000; const TARGET = 5;
  const statements = [];
  const seedPublication = (platform, index) => {
    const id = `pub-${platform}-${index}`;
    const link = `https://example.test/${platform}-${index}`;
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u',?2,?1,?3,?3,'ready',0,1,?4)`).bind(id, platform, link, index));
    statements.push(db.prepare(`INSERT INTO chat_publications(id,user_id,chat_id,published_on,published_at,source,source_key,created_at,platform)
      VALUES (?1,'u',?1,'2027-01-15',?2,'manual',?1,?2,?3)`).bind(id, index, platform));
  };
  for (let index = 0; index < DECOY; index += 1) { seedPublication('telegram', index); if (statements.length >= 200) await db.batch(statements.splice(0)); }
  for (let index = 0; index < TARGET; index += 1) seedPublication('viber', index);
  if (statements.length) await db.batch(statements);
  const { rows } = meter(db);
  const read = await rows(metered => publishedTodayStatement(metered, { userId: 'u', platform: 'viber', date: '2027-01-15', accountId: null }).all());
  // Measured before: joining to chats and filtering c.platform after the join read every platform's
  // publications for the day (≈165 rows to return ~3 — the owner's busy-platform volume, not the
  // requested one). Now platform is indexed on chat_publications itself, so the quiet target platform's
  // cost tracks its own 5 rows, never the decoy platform's 2 000.
  console.log("PUBLISHED_TODAY_ROWS", read);
  assert.ok(read <= TARGET * 5 + 10, `published-today read ${read} rows for ${TARGET} target-platform publications among ${DECOY} decoy ones`);
});

void test('Available-today reads measured against a realistic ready queue', async (t) => {
  const db = await localDatabase(t);
  const READY = 1000;
  const statements = [];
  for (let index = 0; index < READY; index += 1) {
    const id = `avail-${index}`;
    const link = `https://chat.whatsapp.com/Avail${index}`;
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u','whatsapp',?1,?2,?2,'ready',0,1,?3)`).bind(id, link, index));
    // Most chats already published today; only a handful remain actually available.
    if (index >= 5) statements.push(db.prepare(`INSERT INTO chat_publications(id,user_id,chat_id,published_on,published_at,source,source_key,created_at,platform)
      VALUES (?1,'u',?1,'2027-01-15',?2,'manual',?1,?2,'whatsapp')`).bind(id, index));
    if (statements.length >= 200) await db.batch(statements.splice(0));
  }
  if (statements.length) await db.batch(statements);
  const { rows } = meter(db);
  const read = await rows(metered => availableTodayStatement(metered, { userId: 'u', platform: 'whatsapp', date: '2027-01-15', accountId: null, now: NOW }).all());
  console.log("AVAILABLE_TODAY_ROWS", read);
  // This scan is bounded by the ready-queue index (user_id,platform,workflow_status,updated_at), so it
  // must stay near the ready-queue size, never the owner's unrelated chats on other platforms/statuses.
  assert.ok(read <= READY * 2, `available-today read ${read} rows for a ${READY}-chat ready queue`);
});
