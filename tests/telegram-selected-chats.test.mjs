import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSelectedExport, readSelectedChats, readSelectedChatsCount, saveSelectedChats } from '../lib/chats/telegram-selected.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const exportRows = [
  { group_id: 1, title: 'Тихий чат', username: 'QuietChat', link: null, msg_count_in_group: 2, last: '2026-09-01T10:00:00Z' },
  { group_id: 2, title: 'Активний чат', username: 'busy_chat', link: null, msg_count_in_group: 40, last: '2026-09-02T10:00:00Z' },
  { group_id: 3, title: 'Приватний', username: null, link: 'https://t.me/+AbCdEf12345', msg_count_in_group: 9, last: null },
  { group_id: 4, title: 'Без посилання', username: null, link: null, msg_count_in_group: 100, last: null },
  { group_id: 5, title: 'Дубль', username: '@busy_chat', link: null, msg_count_in_group: 3, last: null },
];

void test('export parsing keeps Telegram links, normalizes usernames and drops rows without a link', () => {
  const parsed = parseSelectedExport(exportRows);
  assert.equal(parsed.skipped, 2);
  assert.deepEqual(parsed.items.map(item => [item.link, item.count]), [
    ['https://t.me/quietchat', 2], ['https://t.me/busy_chat', 40], ['https://t.me/+AbCdEf12345', 9],
  ]);
  assert.throws(() => parseSelectedExport([]), /непорожній/);
});

void test('selected chats are ordered by message count and show whether the chat is already in work', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
    VALUES ('c1','u','telegram','Активний чат','https://t.me/busy_chat','https://t.me/busy_chat','waiting',0,1,1)`).run();
  const saved = await saveSelectedChats(db, 'u', parseSelectedExport(exportRows), 100);
  assert.deepEqual(saved.items.map(item => [item.title, item.count, item.status]), [
    ['Активний чат', 40, 'waiting'], ['Приватний', 9, null], ['Тихий чат', 2, null],
  ]);
  assert.equal(saved.importedAt, 100);
  assert.equal(saved.items[0].accountId, null);
  assert.deepEqual(await readSelectedChatsCount(db, 'u'), { count: 3 });

  const reimported = await saveSelectedChats(db, 'u', parseSelectedExport(exportRows.slice(0, 1)), 200);
  assert.deepEqual(reimported.items.map(item => item.title), ['Тихий чат']);
  assert.deepEqual((await readSelectedChats(db, 'other')).items, []);
  assert.deepEqual(await readSelectedChatsCount(db, 'other'), { count: 0 });
});
