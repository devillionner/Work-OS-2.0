import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPublicationFocusPlan, rankPublicationAdvertisements, readPublicationAdvertisementSelection } from '../lib/chats/advertisement-selection.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { recordManualPublication, undoManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';

const row = (id, { title = id, tags = [], platforms = [], uk = 'Текст', ru = '', updated = 1 } = {}) => ({
  id,
  title,
  uk_text: uk,
  ru_text: ru,
  notes: '',
  tags_json: JSON.stringify(tags),
  platforms_json: JSON.stringify(platforms),
  updated_at: updated,
});

const input = (overrides = {}) => ({
  platform: 'whatsapp',
  profileLanguage: 'uk',
  profileDirections: ['Математика'],
  profileConfirmed: true,
  usedToday: new Set(),
  ...overrides,
});

void test('ranking filters platform and prioritizes confirmed direction before generic or other material', () => {
  const items = rankPublicationAdvertisements([
    row('math', { tags: ['математика'], platforms: ['whatsapp'], updated: 1 }),
    row('generic', { updated: 4 }),
    row('english', { tags: ['англійська'], platforms: ['whatsapp'], updated: 3 }),
    row('telegram-only', { tags: ['математика'], platforms: ['telegram'], updated: 9 }),
  ], input());

  assert.deepEqual(items.map((item) => item.id), ['math', 'generic', 'english']);
  assert.equal(items[0].directionMatch, 'matched');
  assert.equal(items[0].recommended, true);
  assert.equal(items[1].directionMatch, 'generic');
  assert.equal(items[2].directionMatch, 'other');
  assert.match(items[2].note || '', /Інший напрямок/);
});

void test('same-platform reuse stays blocked until every suitable choice has been used', () => {
  const rows = [
    row('first', { tags: ['математика'], updated: 1 }),
    row('second', { tags: ['математика'], updated: 2 }),
  ];
  const partlyUsed = rankPublicationAdvertisements(rows, input({ usedToday: new Set(['first']) }));
  assert.equal(partlyUsed.find((item) => item.id === 'first')?.selectable, false);
  assert.match(partlyUsed.find((item) => item.id === 'first')?.note || '', /використано сьогодні/);
  assert.equal(partlyUsed.find((item) => item.id === 'second')?.recommended, true);

  const exhausted = rankPublicationAdvertisements(rows, input({ usedToday: new Set(['first', 'second']) }));
  assert.equal(exhausted.every((item) => item.selectable), true);
  assert.match(exhausted.find((item) => item.id === 'first')?.note || '', /Повтор дозволений/);
});

void test('profile language is preferred with an explicit available-language fallback', () => {
  const [item] = rankPublicationAdvertisements([
    row('uk-only', { platforms: ['whatsapp'], uk: 'Український текст', ru: '' }),
  ], input({ profileLanguage: 'ru', profileDirections: [] }));
  assert.equal(item.suggestedLanguage, 'uk');
  assert.match(item.note || '', /доступна лише UK/);
});

void test('selection queries and publication enforcement remain owner scoped', () => {
  const root = process.cwd();
  const selection = readFileSync(join(root, 'lib', 'chats', 'advertisement-selection.ts'), 'utf8');
  const publication = readFileSync(join(root, 'lib', 'chats', 'publication.ts'), 'utf8');
  assert.match(selection, /c\.id=\?1 AND c\.user_id=\?2/);
  assert.match(selection, /WHERE user_id=\?1 AND kind='advertisement' AND archived_at IS NULL/);
  assert.match(selection, /p\.user_id=\?1 AND c\.platform=\?2 AND p\.published_on=\?3/);
  assert.match(publication, /validatePublicationAdvertisementChoice\(db, \{ userId, chatId: chat\.id, advertisementId, date, allowSameDayReuse: quickMode \}\)/);
});


void test('selection exposes confirmed profile cadence and weekday blocks before manual publish', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'rules-chat', owner: 'u', platform: 'whatsapp', status: 'ready' });
  await db.prepare(`INSERT INTO chat_profiles(chat_id,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES ('rules-chat','daily','[]',NULL,'2026-09-20','[]','','confirmed','manual',1)`).run();

  const dateBlocked = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'rules-chat', date: '2026-09-18' });
  assert.equal(dateBlocked?.publicationAllowed, false);
  assert.match(dateBlocked?.publicationReason || '', /2026-09-20/);

  await db.prepare(`UPDATE chat_profiles SET next_allowed_on=NULL,weekdays_json='[1]' WHERE chat_id='rules-chat'`).run();
  const weekdayBlocked = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'rules-chat', date: '2026-09-18' });
  assert.equal(weekdayBlocked?.publicationAllowed, false);
  assert.match(weekdayBlocked?.publicationReason || '', /не дозволений день/);

  await db.prepare(`UPDATE chat_profiles SET weekdays_json='[5]' WHERE chat_id='rules-chat'`).run();
  const allowed = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'rules-chat', date: '2026-09-18' });
  assert.equal(allowed?.publicationAllowed, true);
  assert.equal(allowed?.publicationReason, null);
});

void test('manual publish dialog explains profile rule blocks and prevents confirmation', () => {
  const source = readFileSync(join(process.cwd(), 'components', 'chat-publish-dialog.tsx'), 'utf8');
  assert.match(source, /Публікація зараз недоступна:/);
  assert.match(source, /profileRequired/);
  assert.match(source, /disabled=\{loading\|\|busy\|\|profileRequired\|\|!publicationRule\.allowed\|\|\(quickMode&&!selected\)\}/);
  assert.match(source, /publicationAllowed!==false/);
});


void test('archived chats are excluded from advertisement selection before publication', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'archived-chat', owner: 'u', platform: 'whatsapp', status: 'archived' });
  const selection = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'archived-chat', date: '2026-09-18' });
  assert.equal(selection, null);
});


void test('focus plan reports stale added/removed directions and only exposes refresh for an open workday', () => {
  const plan = projectPublicationFocusPlan(
    ['Англійська', 'Шахи'],
    1200,
    { id: 'day', workDate: '2026-09-20', version: 4, open: true, plan: { focusDirections: ['Англійська', 'Малювання'], createdAt: 1000 } },
  );
  assert.equal(plan.stale, true);
  assert.deepEqual(plan.currentDirections, ['Англійська', 'ІТ та шахи']);
  assert.deepEqual(plan.planDirections, ['Англійська', 'Малювання']);
  assert.deepEqual(plan.addedDirections, ['ІТ та шахи']);
  assert.deepEqual(plan.removedDirections, ['Малювання']);
  assert.deepEqual(plan.workday, { id: 'day', workDate: '2026-09-20', version: 4 });
});

void test('focus directions filter targeted advertisements but keep generic material available', () => {
  const items = rankPublicationAdvertisements([
    row('english', { tags: ['Англійська'], updated: 3 }),
    row('math', { tags: ['Математика'], updated: 2 }),
    row('generic', { tags: [], updated: 1 }),
  ], input({ profileDirections: [], focusDirections: ['Англійська'] }));
  assert.deepEqual(items.map((item) => item.id), ['english', 'generic']);
});

void test('publish UI shows current focus, stale diff and explicit refresh/keep choices', () => {
  const source = readFileSync(join(process.cwd(), 'components', 'chat-publish-dialog.tsx'), 'utf8');
  assert.match(source, /Активний фокус/);
  assert.match(source, /Поточний план/);
  assert.match(source, /Створено \/ оновлено/);
  assert.match(source, /planCreatedAt\*1000/);
  assert.match(source, /toLocaleString\('uk-UA'\)/);
  assert.match(source, /План застарів після зміни фокусу/);
  assert.match(source, /Оновити невиконану частину/);
  assert.match(source, /Залишити поточний/);
  assert.match(source, /Уже опубліковані пункти не змінено/);
});


void test('manual publication undo restores advertisement usedToday and selectability', async (t) => {
  const db = await localDatabase(t);
  const chat = await seedChat(db, { id: 'ad-undo-chat', owner: 'u', platform: 'whatsapp', status: 'ready' });
  await db.prepare(`INSERT INTO chat_profiles
    (chat_id,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES ('ad-undo-chat','any','[]',NULL,NULL,'[]','','confirmed','manual',1)`).run();
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,title,uk_text,tags_json,platforms_json,created_at,updated_at)
    VALUES ('ad-undo','u','advertisement','Оголошення','Текст','[]','["whatsapp"]',1,1)`).run();

  const before = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'ad-undo-chat', date: '2026-09-10' });
  assert.equal(before?.items.find((item) => item.id === 'ad-undo')?.usedToday, false);
  assert.equal(before?.items.find((item) => item.id === 'ad-undo')?.selectable, true);

  const state = await readChatState(db, 'u', 'ad-undo-chat');
  const published = await recordManualPublication(db, {
    userId:'u', chat:state, accountId:null, advertisementId:'ad-undo', now:Date.parse('2026-09-10T12:00:00Z')/1000,
    date:'2026-09-10', stateToken:state.state_token,
  });
  assert.equal(published.ok, true);
  const afterPublish = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'ad-undo-chat', date: '2026-09-10' });
  assert.equal(afterPublish?.items.find((item) => item.id === 'ad-undo')?.usedToday, true);

  const next = await readChatState(db, 'u', 'ad-undo-chat');
  const undone = await undoManualPublication(db, {
    userId:'u', chat:next, now:Date.parse('2026-09-10T12:00:01Z')/1000, date:'2026-09-10',
  });
  assert.equal(undone.ok, true);
  const afterUndo = await readPublicationAdvertisementSelection(db, { userId: 'u', chatId: 'ad-undo-chat', date: '2026-09-10' });
  const restored = afterUndo?.items.find((item) => item.id === 'ad-undo');
  assert.equal(restored?.usedToday, false);
  assert.equal(restored?.selectable, true);
});
