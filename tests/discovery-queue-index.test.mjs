import assert from 'node:assert/strict';
import test from 'node:test';

import { discoveryExecutorQueueStatement } from '../lib/chat-discovery/executor.ts';
import { localDatabase } from './helpers/local-d1.mjs';

// The single-filter query the indexed version replaced, kept verbatim as the reference behaviour.
const LEGACY_SQL = `SELECT id FROM chat_discovery_candidates
  WHERE user_id=?1 AND imported_chat_id IS NOT NULL AND membership_state<>'left'
    AND platform IN ('whatsapp','viber')
    AND NOT (id LIKE 'waiting-%')
    AND (
      platform<>'whatsapp'
      OR (membership_state='not_checked'
        AND (checked_at IS NULL OR checked_at<=?2-300))
      OR (membership_state='joined' AND (
        decision IN ('rejected','unavailable')
        OR ((decision='review' OR inspection_state<>'inspected')
          AND (checked_at IS NULL OR checked_at<=?2-600))
      ))
    )
  ORDER BY CASE decision WHEN 'rejected' THEN 0 WHEN 'unavailable' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
    updated_at ASC,id
  LIMIT ?3`;

function random(seed) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}
const pick = (next, values) => values[Math.floor(next() * values.length)];

async function seed(db, count) {
  const next = random(42);
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const platform = pick(next, ['whatsapp', 'whatsapp', 'whatsapp', 'viber', 'telegram']);
    const membership = pick(next, ['left', 'left', 'left', 'left', 'pending', 'joined', 'not_checked']);
    const id = next() < 0.03 ? `waiting-${index}` : `cand-${index}`;
    const link = `https://example.test/${platform}/${index}`;
    const chatId = next() < 0.1 ? null : `chat-${index}`;
    if (chatId) statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,'u',?2,?1,?3,?3,'waiting',0,1,1)`).bind(chatId, platform, link));
    statements.push(db.prepare(`INSERT INTO chat_discovery_candidates(id,user_id,platform,name,link,normalized_link,discovered_at,created_at,updated_at,
      membership_state,inspection_state,decision,imported_chat_id,checked_at)
      VALUES (?1,'u',?2,?1,?3,?3,1,1,?4,?5,?6,?7,?8,?9)`).bind(
      id, platform, link, Math.floor(next() * 500),
      membership, pick(next, ['not_checked', 'inspected', 'failed']), pick(next, ['review', 'target', 'rejected', 'unavailable']),
      chatId, next() < 0.3 ? null : Math.floor(next() * 2000)));
    if (statements.length >= 200) await db.batch(statements.splice(0));
  }
  if (statements.length) await db.batch(statements);
}

void test('indexed Discovery queue returns exactly the legacy rows in the legacy order', async (t) => {
  const db = await localDatabase(t);
  await seed(db, 3000);
  for (const now of [0, 700, 1500, 2600]) {
    for (const limit of [5, 5000]) {
      const legacy = await db.prepare(LEGACY_SQL).bind('u', now, limit).all();
      const indexed = await discoveryExecutorQueueStatement(db, 'u', now, limit).all();
      assert.deepEqual(indexed.results.map(row => row.id), legacy.results.map(row => row.id), `now=${now} limit=${limit}`);
      if (limit === 5000) {
        assert.ok(legacy.results.length > 50, 'the seeded data must produce a meaningful queue');
        assert.ok(indexed.meta.rows_read < legacy.meta.rows_read * 0.6, `indexed ${indexed.meta.rows_read} vs legacy ${legacy.meta.rows_read} rows read`);
      }
    }
  }
});
