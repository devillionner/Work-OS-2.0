import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { readChatState } from '../lib/chats/state.ts';
import { recordManualPublication } from '../lib/chats/publication.ts';

const NOW = Date.parse('2026-09-10T12:00:00Z') / 1000;
const DATE = '2026-09-10';

async function publish(db, id = 'chat') {
  const chat = await readChatState(db, 'u', id);
  return recordManualPublication(db, {
    userId: 'u', chat, accountId: null, now: NOW, date: DATE,
    stateToken: chat.state_token,
  });
}

async function profile(db, changes = {}) {
  const value = {
    cadence: 'weekly', weekdays: '[4]', customIntervalDays: null,
    nextAllowedOn: null, reviewStatus: 'confirmed', ...changes,
  };
  await db.prepare(`INSERT INTO chat_profiles(
      chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,
      directions_json,note,review_status,source,updated_at
    ) VALUES ('chat','uk',?1,?2,?3,?4,'[]','',?5,'manual',?6)
    ON CONFLICT(chat_id) DO UPDATE SET cadence=excluded.cadence,
      weekdays_json=excluded.weekdays_json,custom_interval_days=excluded.custom_interval_days,
      next_allowed_on=excluded.next_allowed_on,review_status=excluded.review_status,
      updated_at=excluded.updated_at`)
    .bind(value.cadence, value.weekdays, value.customIntervalDays,
      value.nextAllowedOn, value.reviewStatus, Math.floor(Math.random() * 100000) + 2).run();
}

void test('confirmed profile enforces next date and allowed weekdays', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { status: 'ready' });

  await profile(db, { nextAllowedOn: '2026-09-11' });
  assert.match((await publish(db)).error, /Наступна публікація дозволена/);

  await profile(db, { weekdays: '[5]' });
  assert.match((await publish(db)).error, /не дозволений день/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chat_publications').first()).n, 0);
});

void test('successful confirmed publication advances the cadence atomically', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { status: 'ready' });
  await profile(db);

  assert.equal((await publish(db)).ok, true);
  assert.equal((await db.prepare("SELECT next_allowed_on FROM chat_profiles WHERE chat_id='chat'").first()).next_allowed_on, '2026-09-17');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE event_type='publication'").first()).n, 1);
});

void test('draft profile warns later but does not block urgent manual publication', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { status: 'ready' });
  await profile(db, { reviewStatus: 'draft', weekdays: '[5]', nextAllowedOn: '2026-12-31' });

  assert.equal((await publish(db)).ok, true);
  assert.equal((await db.prepare("SELECT next_allowed_on FROM chat_profiles WHERE chat_id='chat'").first()).next_allowed_on, '2026-12-31');
});
