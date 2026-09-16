import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('lead history dialog explicitly restores focus to its lead-level History trigger', () => {
  const source = readFileSync(new URL('../components/leads/history.tsx', import.meta.url), 'utf8');
  assert.match(source, /finalFocus=\{leadHistoryTrigger\}/);
  assert.match(source, /querySelectorAll<HTMLElement>\('\.lead-action-utility \[data-slot="button"\]'\)/);
  assert.match(source, /element\.textContent\?\.trim\(\) === 'Історія'/);
});
