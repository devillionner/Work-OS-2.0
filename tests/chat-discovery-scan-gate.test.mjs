import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('manual Telegram recovery stays tied to the planned query while autonomous source advancement is executor-owned', async () => {
  const [dialog, route, domain] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/chat-discovery/domain.ts', import.meta.url), 'utf8'),
  ]);

  // The manual Telegram paste form was removed from the Discovery dialog (c4fa30d); the server keeps the
  // query-bound ingest and the dialog must not regain a way to advance the plan by itself.
  assert.doesNotMatch(dialog, /action: 'advance-telegram-plan'/);
  assert.doesNotMatch(route, /body\.action === 'advance-telegram-plan'/);
  assert.match(domain, /advanceAutonomousDiscoveryRun/);
  assert.match(domain, /discoverTelegramPublic/);
  assert.match(domain, /query !== expectedQuery/);
  assert.match(domain, /SET telegram_cursor=\?1,searched_queries=searched_queries\+1/);
  assert.match(domain, /input\.completeQuery === true/);
  assert.match(domain, /merged\.run\.version/);
  // Server-side Telegram ingest is retired: search stays local and D1 is written only after confirmation.
  assert.match(route, /body\.action === 'ingest-telegram'\) \{\s*throw new DiscoveryError\('Telegram source preview тепер локальний\./);
});
