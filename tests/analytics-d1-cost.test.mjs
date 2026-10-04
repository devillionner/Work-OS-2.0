import assert from 'node:assert/strict';
import test from 'node:test';

import { chatActivityStatement } from '../lib/analytics-chats.ts';
import { localDatabase } from './helpers/local-d1.mjs';

// The Analytics page aggregates every activity event of the chosen range, so its D1 cost grows with the
// amount of work, not with a timer. These tests pin both sides of every rewrite: the numbers must equal
// the original SQL exactly (kept below as the reference), and the rows read must stay bounded.

const FROM = '2027-01-01';
const TO = '2027-03-31';
const DAYS = 90;
const CHATS = 300;
const LEADS = 60;
const PLATFORMS = ['telegram', 'whatsapp', 'viber'];

// Reference: the per-chat breakdown exactly as app/api/analytics/route.ts ran it before 2026-10-04.
const REFERENCE_CHAT_ACTIVITY = `SELECT COALESCE(e.chat_id,l.source_chat_id) AS chat_id,c.name,c.platform,c.workflow_status,
    pr.language,pr.directions_json,
    SUM(CASE WHEN e.event_type='chat_joined' THEN 1 ELSE 0 END) AS joined,
    SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
    SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
    SUM(CASE WHEN e.event_type IN ('lesson_booked','curator_booking_pending') THEN 1 ELSE 0 END) AS bookings
  FROM activity_events e
  LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
  LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
  LEFT JOIN chat_profiles pr ON pr.chat_id=c.id
  WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
    AND COALESCE(e.chat_id,l.source_chat_id) IS NOT NULL
  GROUP BY COALESCE(e.chat_id,l.source_chat_id),c.name,c.platform,c.workflow_status,pr.language,pr.directions_json
  HAVING joined>0 OR publications>0 OR responses>0 OR bookings>0
  ORDER BY publications DESC,responses DESC,bookings DESC,joined DESC,c.name ASC LIMIT 100`;

function dateOf(day) {
  return new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10);
}

export async function seedAnalytics(db, { owner = 'u' } = {}) {
  const statements = [];
  const flush = async (force = false) => {
    if (statements.length >= 200 || (force && statements.length)) await db.batch(statements.splice(0));
  };
  for (let index = 0; index < CHATS; index += 1) {
    const platform = PLATFORMS[index % PLATFORMS.length];
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?5,?6,0,1,?7)`).bind(`${owner}-chat-${index}`, owner, platform, `Chat ${String(index).padStart(3, '0')}`,
      `https://example.test/${owner}/${index}`, index % 5 === 0 ? 'archived' : 'ready', index));
    if (index % 3 === 0) statements.push(db.prepare(`INSERT INTO chat_profiles(chat_id,language,directions_json,updated_at)
      VALUES (?1,?2,'["english"]',1)`).bind(`${owner}-chat-${index}`, index % 2 ? 'uk' : 'ru'));
    await flush();
  }
  for (let index = 0; index < LEADS; index += 1) {
    statements.push(db.prepare(`INSERT INTO leads(id,user_id,name,platform,source_chat_id,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'new',1,1)`).bind(`${owner}-lead-${index}`, owner, `Lead ${index}`, PLATFORMS[index % PLATFORMS.length],
      index % 4 === 0 ? null : `${owner}-chat-${(index * 7) % CHATS}`));
    await flush();
  }
  let sequence = 0;
  const event = (type, day, { platform = null, chat = null, lead = null, cancelled = null } = {}) => {
    sequence += 1;
    const id = `${owner}-ev-${sequence}`;
    statements.push(db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,lead_id,occurred_at,event_date,metadata_json,source_key,cancelled_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'{}',?1,?9)`).bind(id, owner, type, platform, chat, lead, 1_800_000_000 + day * 86_400 + sequence, dateOf(day), cancelled));
  };
  for (let day = 0; day < DAYS; day += 1) {
    for (let slot = 0; slot < 60; slot += 1) {
      const chatIndex = (day * 13 + slot * 7) % CHATS;
      const chat = `${owner}-chat-${chatIndex}`;
      const platform = PLATFORMS[chatIndex % PLATFORMS.length];
      event('publication', day, { platform, chat, cancelled: slot % 29 === 0 ? 1 : null });
      if (slot % 3 === 0) event('chat_joined', day, { platform, chat });
      if (slot % 2 === 0) event('chat_state_changed', day, { platform, chat });
    }
    for (let slot = 0; slot < 4; slot += 1) {
      const lead = `${owner}-lead-${(day * 3 + slot) % LEADS}`;
      event('lead_created', day, { lead });
      if (slot % 2 === 0) event('lesson_booked', day, { lead });
    }
    if (day % 10 === 0) event('chat_bulk_added', day);
    await flush();
  }
  await flush(true);
  return sequence;
}

function meter(db) {
  let rows = 0;
  const count = (result) => { rows += result?.meta?.rows_read || 0; return result; };
  const wrap = (statement) => {
    const wrapped = Object.create(statement);
    wrapped.bind = (...values) => wrap(statement.bind(...values));
    wrapped.all = async () => count(await statement.all());
    return wrapped;
  };
  return {
    db: new Proxy(db, { get(target, property) {
      if (property === 'prepare') return (sql) => wrap(target.prepare(sql));
      if (property === 'batch') return async (statements) => { const results = await target.batch(statements); results.forEach(count); return results; };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    } }),
    take() { const value = rows; rows = 0; return value; },
  };
}

void test('per-chat analytics breakdown equals the reference SQL and reads fewer rows', async (t) => {
  const db = await localDatabase(t);
  const events = await seedAnalytics(db);
  await seedAnalytics(db, { owner: 'other' });

  const reference = await db.prepare(REFERENCE_CHAT_ACTIVITY).bind('u', FROM, TO).all();
  const metered = meter(db);
  const actual = await chatActivityStatement(metered.db, 'u', FROM, TO).all();
  const rows = metered.take();

  assert.equal(actual.results.length, 100);
  assert.deepEqual(actual.results, reference.results);
  // Measured on this seed: 34 771 rows for the reference (chats/profiles joined per event), 19 324 now.
  assert.ok(rows <= events * 2, `per-chat breakdown read ${rows} rows for ${events} events`);
  assert.ok(rows < reference.meta.rows_read * 0.6, `per-chat breakdown read ${rows} rows, reference ${reference.meta.rows_read}`);
});
