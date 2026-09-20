import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_RANKING_MIN_PUBLICATIONS,
  hasEnoughChatRankingData,
  rankAnalyticsChats,
  responseConversionLabel,
} from '../lib/analytics-chat-ranking.ts';

const root = process.cwd();
const chat = (overrides = {}) => ({
  id: 'chat',
  name: 'Chat',
  platform: 'telegram',
  platformName: 'Telegram',
  joined: 0,
  publications: 5,
  responses: 1,
  bookings: 0,
  publicationRate: 0,
  responseRate: 20,
  bookingRate: 0,
  language: 'uk',
  directions: ['Англійська'],
  ...overrides,
});

void test('chat ranking filters profile dimensions and keeps small samples below comparable rows', () => {
  const rows = [
    chat({ id: 'a', name: 'A', publications: 10, responses: 4, responseRate: 40 }),
    chat({ id: 'b', name: 'B', platform: 'whatsapp', platformName: 'WhatsApp', publications: 3, responses: 2, responseRate: 66.7, language: 'ru', directions: ['Математика'] }),
    chat({ id: 'c', name: 'C', publications: 2, responses: 2, responseRate: 100 }),
  ];
  assert.deepEqual(
    rankAnalyticsChats(rows, { platform: 'all', direction: 'all', language: 'all' }).map((row) => row.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    rankAnalyticsChats(rows, { platform: 'whatsapp', direction: 'Математика', language: 'ru' }).map((row) => row.id),
    ['b'],
  );
  assert.equal(CHAT_RANKING_MIN_PUBLICATIONS, 3);
  assert.equal(hasEnoughChatRankingData(rows[1]), true);
  assert.equal(hasEnoughChatRankingData(rows[2]), false);
});

void test('chat ranking avoids a fake zero-percent conversion when there were no publications', () => {
  assert.equal(responseConversionLabel(chat({ publications: 0, responseRate: 0 })), '—');
  assert.equal(responseConversionLabel(chat({ publications: 4, responseRate: 25 })), '25%');
});

void test('analytics ranking UI and API expose platform direction language and confidence contracts', () => {
  const route = readFileSync(join(root, 'app', 'api', 'analytics', 'route.ts'), 'utf8');
  const workspace = readFileSync(join(root, 'components', 'analytics-workspace.tsx'), 'utf8');
  const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

  assert.match(route, /LEFT JOIN chat_profiles pr ON pr\.chat_id=c\.id/);
  assert.match(route, /pr\.language,pr\.directions_json/);
  assert.match(workspace, /aria-label="Фільтри рейтингу чатів"/);
  for (const label of ['Платформа', 'Напрямок', 'Мова', 'Недостатньо даних'])
    assert.match(workspace, new RegExp(label));
  assert.match(workspace, /responseConversionLabel\(chat\)/);
  assert.match(css, /\.analytics-ranking-controls select \{[^}]*min-height:42px;/s);
  assert.match(css, /\.analytics-ranking-controls select \{ min-height:44px; \}/);
});
