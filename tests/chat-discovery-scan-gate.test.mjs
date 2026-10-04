import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('the manual Telegram paste/advance form stays removed from Discovery', async () => {
  const [dialog, route] = await Promise.all([
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/chat-discovery/route.ts', import.meta.url), 'utf8'),
  ]);

  // The manual Telegram paste form was removed from the Discovery dialog (c4fa30d). Telegram scanning now
  // happens entirely in the browser/runner (previewTelegramDiscoveryText takes already-scanned text), so
  // neither the dialog nor the route may regain a way to advance a server-side plan by themselves.
  assert.doesNotMatch(dialog, /action: 'advance-telegram-plan'/);
  assert.doesNotMatch(route, /body\.action === 'advance-telegram-plan'/);
  // Server-side Telegram ingest is retired: search stays local and D1 is written only after confirmation.
  assert.match(route, /body\.action === 'ingest-telegram'\) \{\s*throw new DiscoveryError\('Telegram source preview тепер локальний\./);
});
