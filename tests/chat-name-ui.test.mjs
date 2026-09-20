import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('global chat-name maintenance exposes progress, per-platform summary, errors and confirmations', () => {
  const dialog=readFileSync(new URL('../components/chat-names-dialog.tsx',import.meta.url),'utf8');
  const settings=readFileSync(new URL('../components/settings-workspace.tsx',import.meta.url),'utf8');
  assert.match(settings,/Перевірити назви всіх чатів/);
  for(const label of ['Перевірено','Оновлено','Без змін','Потрібне підтвердження','Помилки']) assert.match(dialog,new RegExp(label));
  assert.match(dialog,/Замінити/);
  assert.match(dialog,/Зупинити/);
  assert.match(dialog,/Telegram, WhatsApp, Viber і Facebook/);
});
