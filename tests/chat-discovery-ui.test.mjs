import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Platforms exposes a real Chat Discovery workflow instead of an API-only feature', async () => {
  const [workspace, dialog] = await Promise.all([
    readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(workspace, /ChatDiscoveryDialog/);
  assert.match(workspace, /Знайти чати/);
  assert.match(dialog, /Почати пошук/);
  assert.match(dialog, /Продовжити пошук/);
  assert.match(dialog, /Зупинити/);
  assert.match(dialog, /Додати на перевірку/);
  assert.match(dialog, /Звідки знайдено/);
  assert.match(dialog, /unknown_member_count/);
  assert.match(dialog, /while \(run\.status === 'running'/);
});

void test('discovery UI keeps candidate goal distinct from confirmed target qualification', async () => {
  const dialog = await readFile(new URL('../components/chat-discovery-dialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Нових кандидатів за запуск/);
  assert.match(dialog, /Мінімум учасників для target/);
  assert.match(dialog, /Невідомі критерії не вважаються підтвердженими/);
});
