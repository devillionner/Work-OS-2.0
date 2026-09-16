import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');

void test('lead contact card copies phone, Telegram and note with safe clipboard recovery', () => {
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(source, /Не вдалося скопіювати \$\{label\.toLowerCase\(\)\}\. Скопіюйте вручну\./);
  assert.match(source, />Копіювати телефон<\/Button>/);
  assert.match(source, />Копіювати Telegram<\/Button>/);
  assert.match(source, />Копіювати нотатку<\/Button>/);
});
