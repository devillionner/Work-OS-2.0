import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { findChatDuplicates } from '../lib/chats/duplicates.ts';

async function rename(db, id, { name, link, normalizedLink = link, accountId = null, reason = null }) {
  await db.prepare(`UPDATE chats SET name=?1,link=?2,normalized_link=?3,telegram_account_id=?4,archive_reason=?5 WHERE id=?6`)
    .bind(name, link, normalizedLink, accountId, reason, id).run();
}

void test('exact canonical links win even across active and archived states', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'active', platform: 'telegram', status: 'ready' });
  await seedChat(db, { id: 'archived', platform: 'telegram', status: 'archived' });
  await rename(db, 'active', { name: 'Батьки Львів', link: 'https://telegram.me/MyGroup', normalizedLink: 'https://telegram.me/MyGroup' });
  await rename(db, 'archived', { name: 'Інша назва', link: 'https://t.me/mygroup?utm_source=x', normalizedLink: 'https://t.me/mygroup', reason: 'Дублікат' });

  const groups = await findChatDuplicates(db, { userId: 'u', platform: 'telegram' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'link');
  assert.deepEqual(groups[0].chats.map((chat) => chat.id).sort(), ['active', 'archived']);
  assert.equal(groups[0].chats.find((chat) => chat.id === 'archived').archiveReason, 'Дублікат');
});

void test('same normalized name with different links is only a manual-review candidate', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'one', platform: 'whatsapp', status: 'ready' });
  await seedChat(db, { id: 'two', platform: 'whatsapp', status: 'waiting' });
  await rename(db, 'one', { name: '  Робота   Україна  ', link: 'https://chat.whatsapp.com/AAAA' });
  await rename(db, 'two', { name: 'робота україна', link: 'https://chat.whatsapp.com/BBBB' });

  const groups = await findChatDuplicates(db, { userId: 'u', platform: 'whatsapp' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'name');
  assert.deepEqual(groups[0].chats.map((chat) => chat.id).sort(), ['one', 'two']);
});

void test('duplicate scan is owner scoped and Telegram account scoped', async (t) => {
  const db = await localDatabase(t);
  for (const id of ['a-one', 'a-two', 'b-one', 'b-two']) await seedChat(db, { id, platform: 'telegram', status: 'ready' });
  await seedChat(db, { id: 'foreign', owner: 'other', platform: 'telegram', status: 'ready' });
  for (const id of ['a-one', 'a-two']) await rename(db, id, { name: id, link: 'https://t.me/audience', accountId: 'a' });
  for (const id of ['b-one', 'b-two']) await rename(db, id, { name: id, link: 'https://t.me/otheraudience', accountId: 'b' });
  await rename(db, 'foreign', { name: 'foreign', link: 'https://t.me/audience', accountId: 'a' });

  const accountA = await findChatDuplicates(db, { userId: 'u', platform: 'telegram', telegramAccountId: 'a' });
  assert.equal(accountA.length, 1);
  assert.deepEqual(accountA[0].chats.map((chat) => chat.id).sort(), ['a-one', 'a-two']);
  assert.equal(accountA[0].chats.some((chat) => chat.id === 'foreign'), false);
});

void test('same name and same link does not create a second name-candidate group', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'one', platform: 'facebook', status: 'ready' });
  await seedChat(db, { id: 'two', platform: 'facebook', status: 'archived' });
  await rename(db, 'one', { name: 'Українці Варшава', link: 'https://facebook.com/groups/UAWarsaw' });
  await rename(db, 'two', { name: 'українці варшава', link: 'https://m.facebook.com/groups/uawarsaw/' });

  const groups = await findChatDuplicates(db, { userId: 'u', platform: 'facebook' });
  assert.deepEqual(groups.map((group) => group.reason), ['link']);
});
