import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { readChatState } from '../lib/chats/state.ts';
import { saveChatProfile, validateChatProfile } from '../lib/chats/profile.ts';
import { activitySummaryStatement } from '../lib/activity-summary.ts';

const NOW = Date.parse('2026-09-11T22:30:00Z') / 1000;
const profile = (changes = {}) => ({ name: 'Батьки 7 клас', language: 'uk', cadence: 'weekly', weekdays: [1, 3, 1], directions: ['математика', 'англійська'], note: 'Публікувати після 18:00', reviewStatus: 'confirmed', ...changes });

void test('profile validation normalizes lists and rejects unsafe values', () => {
  assert.deepEqual(validateChatProfile(profile()), { name: 'Батьки 7 клас', language: 'uk', cadence: 'weekly', weekdays: [1, 3], customIntervalDays: null, nextAllowedOn: null, directions: ['математика', 'англійська'], note: 'Публікувати після 18:00', reviewStatus: 'confirmed' });
  for (const changes of [{ language: 'en' }, { cadence: 'hourly' }, { weekdays: [0] }, { directions: Array.from({ length: 13 }, () => 'x') }, { name: ' ' }, { name: '😊'.repeat(181) }]) assert.throws(() => validateChatProfile(profile(changes)));
});

void test('profile save creates or updates one profile, name and audit event atomically', async t => {
  const db = await localDatabase(t); await seedChat(db, { platform: 'telegram', status: 'ready' });
  const before = await readChatState(db, 'u', 'chat');
  const saved = await saveChatProfile(db, { userId: 'u', chatId: 'chat', stateToken: before.state_token, now: NOW, profile: profile() });
  assert.equal(saved.ok, true);
  assert.deepEqual(await db.prepare("SELECT name,updated_at FROM chats WHERE id='chat'").first(), { name: 'Батьки 7 клас', updated_at: NOW });
  assert.deepEqual(await db.prepare("SELECT language,cadence,weekdays_json,directions_json,note,review_status,source FROM chat_profiles WHERE chat_id='chat'").first(), { language: 'uk', cadence: 'weekly', weekdays_json: '[1,3]', directions_json: '["математика","англійська"]', note: 'Публікувати після 18:00', review_status: 'confirmed', source: 'manual' });
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE event_type='chat_profile_changed'").first()).n, 1);
  assert.equal((await activitySummaryStatement(db, 'u', '2026-09-11', '2026-09-11').all()).results.length, 0);
  const after = await readChatState(db, 'u', 'chat'); assert.notEqual(after.state_token, before.state_token);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE event_type='chat_profile_changed'").first()).n, 1);
  const updated = await saveChatProfile(db, { userId: 'u', chatId: 'chat', stateToken: after.state_token, now: NOW, profile: profile({ name: 'Оновлена назва', reviewStatus: 'draft' }) });
  assert.equal(updated.ok, true); assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_profiles").first()).n, 1); assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE event_type='chat_profile_changed'").first()).n, 2);
});

void test('stale profile save, foreign owner and database failure make no partial change', async t => {
  const db = await localDatabase(t); await seedChat(db, { platform: 'whatsapp', status: 'ready' }); const before = await readChatState(db, 'u', 'chat');
  const first = await saveChatProfile(db, { userId: 'u', chatId: 'chat', stateToken: before.state_token, now: NOW, profile: profile() }); assert.equal(first.ok, true);
  const stale = await saveChatProfile(db, { userId: 'u', chatId: 'chat', stateToken: before.state_token, now: NOW + 1, profile: profile({ name: 'Стара назва' }) }); assert.equal(stale.ok, false);
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='chat'").first()).name, 'Батьки 7 клас');
  const foreign = await saveChatProfile(db, { userId: 'other', chatId: 'chat', stateToken: before.state_token, now: NOW, profile: profile({ name: 'Чужа' }) }); assert.equal(foreign.ok, false);
  await db.prepare("CREATE TRIGGER fail_profile BEFORE INSERT ON activity_events WHEN NEW.event_type='chat_profile_changed' BEGIN SELECT RAISE(ABORT,'injected profile failure'); END").run();
  const current = await readChatState(db, 'u', 'chat'); await assert.rejects(saveChatProfile(db, { userId: 'u', chatId: 'chat', stateToken: current.state_token, now: NOW + 2, profile: profile({ name: 'Не зберегти' }) }), /injected profile failure/);
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='chat'").first()).name, 'Батьки 7 клас'); assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_profiles").first()).n, 1);
});
