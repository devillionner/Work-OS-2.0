import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../components/leads/today-activity.tsx', import.meta.url),
  'utf8',
);

void test('Leads today exposes loading state to assistive technology', () => {
  assert.match(source, /aria-busy=\{loading\}/);
  assert.match(source, /role="status">Завантажуємо активність…<\/p>/);
});

void test('Leads today open actions identify the target lead', () => {
  assert.match(source, /aria-label=\{`Відкрити ліда \$\{item\.name\}`\}/);
});
