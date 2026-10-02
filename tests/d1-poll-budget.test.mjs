import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDiscoveryExecutorQueue, wakeDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import { claimWaitingWhatsAppCheck, readWaitingWhatsAppCheckStatus } from '../lib/chats/whatsapp-waiting-check.ts';
import { claimWhatsAppAutopostJob } from '../lib/messenger-automation.ts';
import { addSelectedChatToJoin, readSelectedChats, readSelectedChatsCount, saveSelectedChats } from '../lib/chats/telegram-selected.ts';
import { readSyncRevision } from '../lib/sync-revision.ts';
import { archiveLocalDiscoveryOutcomes, previewTelegramDiscoveryText, readDiscoveryTelegramGroupSources } from '../lib/chat-discovery/local-preview.ts';
import { enrichImportedChatNames } from '../lib/chats/name-enrichment.ts';
import { chatListPageStatement } from '../lib/chats/list-query.ts';
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

  const firstDiscovery = await rows(metered => claimDiscoveryExecutorQueue(metered, 'u', 'device', 1, NOW));
  assert.ok(firstDiscovery >= CANDIDATES, 'the seeded data must make the uncached queue read expensive');
  assert.ok(await rows(metered => claimDiscoveryExecutorQueue(metered, 'u', 'device', 1, NOW + 10)) <= 3, 'repeated empty Discovery polls must be served from the idle marker');
  assert.ok(await rows(metered => claimWaitingWhatsAppCheck(metered, 'u', 'device', NOW)) <= 2);
  assert.ok(await rows(metered => claimWhatsAppAutopostJob(metered, 'u', 'device', NOW)) <= 5);

  await wakeDiscoveryExecutorQueue(db, 'u');
  assert.ok(await rows(metered => claimDiscoveryExecutorQueue(metered, 'u', 'device', 1, NOW + 20)) >= CANDIDATES, 'an operator action wakes the queue immediately');
});

void test('page polls (sync revision, Waiting-check status, Telegram selected list) stay bounded', async (t) => {
  const db = await localDatabase(t);
  await seed(db);
  const { rows } = meter(db);
  assert.ok(await rows(metered => readSyncRevision(metered, 'u')) <= 2);
  assert.ok(await rows(metered => readWaitingWhatsAppCheckStatus(metered, 'u')) <= 10);

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
    if (statements.length >= 200) await db.batch(statements.splice(0));
  }
  if (statements.length) await db.batch(statements);
  const { rows } = meter(db);
  const page = status => rows(metered => chatListPageStatement(metered, { userId: 'u', platform: 'whatsapp', status, needsReview: false, today: '2027-01-15', now: NOW, offset: 0, accountId: null }).all());

  // Measured: 150 rows for a 50-row page (was ≈5 900 with the `?3='profile_review' OR …` filter).
  for (const status of ['waiting', 'ready']) {
    const read = await page(status);
    assert.ok(read <= 200, `${status} page read ${read} rows`);
  }
  // Two statuses must be sorted, so the review queue reads that queue (600 chats): measured 1 803 rows.
  const review = await page('profile_review');
  assert.ok(review <= 600 * 4, `profile_review page read ${review} rows`);
});
