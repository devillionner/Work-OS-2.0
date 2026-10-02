import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDiscoveryExecutorQueue, wakeDiscoveryExecutorQueue } from '../lib/chat-discovery/executor.ts';
import { claimWaitingWhatsAppCheck, readWaitingWhatsAppCheckStatus } from '../lib/chats/whatsapp-waiting-check.ts';
import { claimWhatsAppAutopostJob } from '../lib/messenger-automation.ts';
import { readSelectedChats, readSelectedChatsCount, saveSelectedChats } from '../lib/chats/telegram-selected.ts';
import { readSyncRevision } from '../lib/sync-revision.ts';
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
  assert.ok(await rows(metered => claimDiscoveryExecutorQueue(metered, 'u', 'device', 1, NOW + 10)) <= 2, 'repeated empty Discovery polls must be served from the idle marker');
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

  const items = Array.from({ length: 1000 }, (_, index) => ({ link: `https://t.me/budget_chat_${index}`, title: `Чат ${index}`, count: index, last: null }));
  await saveSelectedChats(db, 'u', { items, skipped: 0 }, NOW);
  assert.ok(await rows(metered => readSelectedChatsCount(metered, 'u')) <= 2, 'the tab badge must not look up every chat');
  assert.ok(await rows(metered => readSelectedChats(metered, 'u')) <= items.length * 3, 'selected list must use index lookups, not scan all chats');
});
