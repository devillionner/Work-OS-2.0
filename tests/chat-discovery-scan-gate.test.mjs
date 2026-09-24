import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Telegram plan advances only through ingestion of the current planned query', async () => {
  const [dialog, route, domain] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(dialog, /action: 'ingest-telegram'/);
  assert.doesNotMatch(dialog, /action: 'advance-telegram-plan'/);
  assert.doesNotMatch(route, /body\.action === 'advance-telegram-plan'/);
  assert.match(domain, /query !== expectedQuery/);
  assert.match(domain, /SET telegram_cursor=\?1,searched_queries=searched_queries\+1/);
  assert.match(domain, /input\.completeQuery === true/);
  assert.match(domain, /merged\.run\.version/);
  assert.match(route, /completeQuery: body\.completeQuery/);
  assert.match(dialog, /async function ingestTelegramScan\(completeQuery: boolean\)/);
  assert.match(dialog, /ingestTelegramScan\(false\)/);
  assert.match(dialog, /ingestTelegramScan\(true\)/);
  assert.match(dialog, /completeQuery,/);
  assert.match(dialog, /«Зберегти джерело» не рухає план/);
});
