import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Telegram plan cannot advance until the current query scan is submitted', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');

  assert.match(dialog, /const \[telegramProcessedQuery, setTelegramProcessedQuery\] = useState\(''\)/);
  assert.match(dialog, /telegramProcessedQuery !== currentQuery/);
  assert.match(dialog, /setTelegramProcessedQuery\(workspace\.telegramPlan\?\.tasks\[0\]\?\.query \|\| ''\)/);
  assert.match(dialog, /Скан передано → наступний/);
  assert.match(dialog, /setTelegramProcessedQuery\(''\)/);
  assert.match(dialog, /action: 'ingest-telegram'/);
  assert.match(dialog, /action: 'advance-telegram-plan'/);
});
