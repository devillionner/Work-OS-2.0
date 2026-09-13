import assert from 'node:assert/strict';
import test from 'node:test';
import { readHistoricalPublicationOptions, recordHistoricalPublication } from '../lib/reports/publication-correction.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const DATE = '2026-09-10';
const NOW = Math.floor(Date.parse('2026-09-13T12:00:00Z') / 1000);

void test('historical publication options are owner scoped and exclude chats already published that day', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat-open', owner: 'u', platform: 'whatsapp', status: 'ready' });
  await seedChat(db, { id: 'chat-used', owner: 'u', platform: 'telegram', status: 'archived' });
  await seedChat(db, { id: 'chat-other', owner: 'other', platform: 'whatsapp', status: 'ready' });
  await db.prepare(`INSERT INTO chat_publications(id,user_id,chat_id,published_on,published_at,source,source_key,created_at)
    VALUES ('pub-used','u','chat-used',?1,100,'manual','pub-used',100)`).bind(DATE).run();
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,title,created_at,updated_at)
    VALUES ('ad-u','u','advertisement','Активне оголошення',1,1),('ad-other','other','advertisement','Чуже оголошення',1,1)`).run();

  const options = await readHistoricalPublicationOptions(db, { userId: 'u', date: DATE });
  assert.deepEqual(options.chats.map((chat) => chat.id), ['chat-open']);
  assert.ok(options.accounts.length >= 1);
  assert.ok(options.accounts.every((account) => !account.id.startsWith('other:')));
  assert.deepEqual(options.advertisements, [{ id: 'ad-u', title: 'Активне оголошення' }]);
});

void test('historical publication writes accounting truth without mutating current scheduler or profile cadence', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'chat-u', owner: 'u', platform: 'telegram', status: 'ready' });
  await seedChat(db, { id: 'chat-other', owner: 'other', platform: 'telegram', status: 'ready' });
  await db.prepare(`UPDATE chats SET telegram_account_id='u:tg1',updated_at=111 WHERE id='chat-u'`).run();
  await db.prepare(`UPDATE chats SET telegram_account_id='other:tg1',updated_at=222 WHERE id='chat-other'`).run();
  await db.prepare(`INSERT INTO chat_profiles(chat_id,review_status,next_allowed_on,updated_at)
    VALUES ('chat-u','confirmed','2026-09-20',333)`).run();
  await db.prepare(`INSERT INTO telegram_schedule_slots(id,user_id,telegram_account_id,sequence,scheduled_at,chat_id,status,created_at,updated_at)
    VALUES ('slot-u','u','u:tg1',1,?1,'chat-u','pending',444,444)`).bind(NOW + 3600).run();
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,title,created_at,updated_at)
    VALUES ('ad-u','u','advertisement','Оголошення',1,1)`).run();

  const result = await recordHistoricalPublication(db, {
    userId: 'u', chatId: 'chat-u', date: DATE, now: NOW,
    telegramAccountId: 'u:tg1', advertisementId: 'ad-u', language: 'uk',
  });

  const publication = await db.prepare(`SELECT user_id,chat_id,published_on,published_at,advertisement_id,source,telegram_account_id
    FROM chat_publications WHERE id=?1`).bind(result.publicationId).first();
  assert.deepEqual(publication, {
    user_id: 'u', chat_id: 'chat-u', published_on: DATE, published_at: NOW,
    advertisement_id: 'ad-u', source: 'report_correction', telegram_account_id: 'u:tg1',
  });
  const event = await db.prepare(`SELECT user_id,event_type,chat_id,occurred_at,event_date,metadata_json,telegram_account_id
    FROM activity_events WHERE id=?1`).bind(result.eventId).first();
  assert.equal(event.user_id, 'u');
  assert.equal(event.event_type, 'publication');
  assert.equal(event.chat_id, 'chat-u');
  assert.equal(Number(event.occurred_at), NOW);
  assert.equal(event.event_date, DATE);
  assert.equal(event.telegram_account_id, 'u:tg1');
  assert.deepEqual(JSON.parse(event.metadata_json), { correction: 'historical_report', accountingDate: DATE, advertisementId: 'ad-u', language: 'uk' });

  assert.deepEqual(await db.prepare(`SELECT status,completed_at,publication_id,updated_at FROM telegram_schedule_slots WHERE id='slot-u'`).first(), {
    status: 'pending', completed_at: null, publication_id: null, updated_at: 444,
  });
  assert.deepEqual(await db.prepare(`SELECT next_allowed_on,updated_at FROM chat_profiles WHERE chat_id='chat-u'`).first(), {
    next_allowed_on: '2026-09-20', updated_at: 333,
  });
  assert.equal(await db.prepare(`SELECT updated_at FROM chats WHERE id='chat-u'`).first('updated_at'), 111);

  await assert.rejects(
    recordHistoricalPublication(db, { userId: 'u', chatId: 'chat-u', date: DATE, now: NOW, telegramAccountId: 'u:tg1' }),
    /вже існує/,
  );
  assert.equal(await db.prepare(`SELECT COUNT(*) AS count FROM activity_events WHERE user_id='u' AND event_type='publication' AND event_date=?1`).bind(DATE).first('count'), 1);
  await assert.rejects(
    recordHistoricalPublication(db, { userId: 'u', chatId: 'chat-other', date: DATE, now: NOW, telegramAccountId: 'other:tg1' }),
    /Чат не знайдено/,
  );
  await assert.rejects(
    recordHistoricalPublication(db, { userId: 'u', chatId: 'chat-u', date: '2026-09-14', now: NOW, telegramAccountId: 'u:tg1' }),
    /майбутньому/,
  );
});
