import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('Work OS restores the last active workspace per browser device', () => {
  const source = readFileSync(new URL('../components/view-persistence.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

  assert.match(source, /const STORAGE_KEY = 'work-os:active-view'/);
  assert.match(source, /window\.localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(source, /if \(target\) target\.click\(\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /window\.localStorage\.setItem\(STORAGE_KEY, current\)/);
  assert.match(layout, /<ViewPersistence \/>/);
});
