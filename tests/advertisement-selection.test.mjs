import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { readPublicationAdvertisementSelection } from '../lib/chats/advertisement-selection.ts';
import { recordManualPublication } from '../lib/chats/publication.ts';

const DATE = '2026-09-16';
const NOW = 1_800_000_000;

async function seedAdvertisement(db, { id, title, tags = [], platforms = [], uk = 'Текст', ru = '', archived = null, owner = 'u' }) {
  await db.prepare(`INSERT INTO library_items
    (id,user_id,kind,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at)
    VALUES (?1,?2,'advertisement',?3,?4,?5,'',?6,?7,?8,1,?9)`)
    .bind(id, owner, title, uk, ru, JSON.stringify(tags), JSON.stringify(platforms), archived, Number(id.replace(/\D/g, '')) || 1).run();
}

async function seedProfile(db, chatId, { language = 'uk', directions = ['Математика'], confirmed = true } = {}) {
  await db.prepare(`INSERT INTO chat_profiles
    (chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES (?1,?2,'any','[]',NULL,NULL,?3,'',?4,'manual',1)`)
    .bind(chatId, language, JSON.stringify(directions), confirmed ? 'confirmed' : 'draft').run();
}

void test('publish selection is owner/platform/profile aware and keeps archived or foreign ads out', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'target', platform: 'whatsapp', status: 'ready' });
  await seedProfile(db, 'target');
  await seedAdvertisement(db, { id: 'ad1', title: 'Математика', tags: ['математика'], platforms: ['whatsapp'] });
  await seedAdvertisement(db, { id: 'ad2', title: 'Без напрямку', tags: [], platforms: [] });
  await seedAdvertisement(db, { id: 'ad3', title: 'Англійська', tags: ['англійська'], platforms: ['whatsapp'] });
  await seedAdvertisement(db, { id: 'ad4', title: 'Telegram only', tags: ['математика'], platforms: ['telegram'] });
  await seedAdvertisement(db, { id: 'ad5', title: 'Архів', tags: ['математика'], platforms: ['whatsapp'], archived: 5 });
  await seedAdvertisement(db, { id: 'ad6', title: 'Чуже', tags: ['математика'], platforms: ['whatsapp'], owner: 'other' });

  const selection = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'target', date: DATE });
  assert.ok(selection);
  assert.equal(selection.profileConfirmed, true);
  assert.deepEqual(selection.items.map((item) => item.id), ['ad1', 'ad2', 'ad3']);
  assert.equal(selection.items[0].directionMatch, 'matched');
  assert.equal(selection.items[0].recommended, true);
  assert.equal(selection.items[2].directionMatch, 'other');
  assert.equal(await readPublicationAdvertisementSelection(db, { userId: 'other', chatId: 'target', date: DATE }), null);
});

void test('same-platform daily reuse is blocked while an unused suitable ad exists and allowed after exhaustion', async (t) => {
  const db = await localDatabase(t);
  const first = await seedChat(db, { id: 'first', platform: 'whatsapp', status: 'ready' });
  const second = await seedChat(db, { id: 'second', platform: 'whatsapp', status: 'ready' });
  const third = await seedChat(db, { id: 'third', platform: 'whatsapp', status: 'ready' });
  for (const id of ['first', 'second', 'third']) await seedProfile(db, id);
  await seedAdvertisement(db, { id: 'ad1', title: 'Варіант 1', tags: ['математика'], platforms: ['whatsapp'] });
  await seedAdvertisement(db, { id: 'ad2', title: 'Варіант 2', tags: ['математика'], platforms: ['whatsapp'] });

  assert.equal((await recordManualPublication(db, { userId: 'u', chat: first, accountId: null, advertisementId: 'ad1', language: 'uk', now: NOW, date: DATE, stateToken: first.state_token })).ok, true);
  const afterFirst = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'second', date: DATE });
  assert.ok(afterFirst);
  assert.equal(afterFirst.items.find((item) => item.id === 'ad1')?.selectable, false);
  assert.equal(afterFirst.items.find((item) => item.id === 'ad2')?.recommended, true);

  const blocked = await recordManualPublication(db, { userId: 'u', chat: second, accountId: null, advertisementId: 'ad1', language: 'uk', now: NOW + 1, date: DATE, stateToken: second.state_token });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /використано сьогодні/);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM chat_publications WHERE chat_id='second'").first()).n, 0);

  assert.equal((await recordManualPublication(db, { userId: 'u', chat: second, accountId: null, advertisementId: 'ad2', language: 'uk', now: NOW + 2, date: DATE, stateToken: second.state_token })).ok, true);
  const exhausted = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'third', date: DATE });
  assert.ok(exhausted);
  assert.equal(exhausted.items.find((item) => item.id === 'ad1')?.selectable, true);
  assert.match(exhausted.items.find((item) => item.id === 'ad1')?.note || '', /Повтор дозволений/);
  assert.equal((await recordManualPublication(db, { userId: 'u', chat: third, accountId: null, advertisementId: 'ad1', language: 'uk', now: NOW + 3, date: DATE, stateToken: third.state_token })).ok, true);
});

void test('selection suggests profile language with explicit fallback and manual publish without material stays valid', async (t) => {
  const db = await localDatabase(t);
  const chat = await seedChat(db, { id: 'chat', platform: 'facebook', status: 'ready' });
  await seedProfile(db, 'chat', { language: 'ru', directions: [], confirmed: true });
  await seedAdvertisement(db, { id: 'uk-only', title: 'Лише UA', platforms: ['facebook'], uk: 'Український текст', ru: '' });
  const selection = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'chat', date: DATE });
  assert.ok(selection);
  assert.equal(selection.items[0].suggestedLanguage, 'uk');
  assert.match(selection.items[0].note || '', /доступна лише UK/);
  assert.equal((await recordManualPublication(db, { userId: 'u', chat, accountId: null, advertisementId: null, language: null, now: NOW, date: DATE, stateToken: chat.state_token })).ok, true);
});
