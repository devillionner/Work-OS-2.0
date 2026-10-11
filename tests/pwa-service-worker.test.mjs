import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('PWA service worker is network-only and never stores cloud data', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\('fetch'/);
  assert.match(source, /fetch\(event\.request\)/);
  assert.doesNotMatch(source, /caches\.open/);
  assert.doesNotMatch(source, /cache\.put/);
  assert.doesNotMatch(source, /addAll/);
  assert.doesNotMatch(source, /CacheStorage/);
});
