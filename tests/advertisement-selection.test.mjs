import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rankPublicationAdvertisements } from '../lib/chats/advertisement-selection.ts';

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
  assert.match(publication, /validatePublicationAdvertisementChoice\(db, \{ userId, chatId: chat\.id, advertisementId, date \}\)/);
});
