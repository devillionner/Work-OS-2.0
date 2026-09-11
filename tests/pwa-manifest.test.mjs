import assert from 'node:assert/strict';
import test from 'node:test';
import manifest from '../app/manifest.ts';

void test('PWA manifest installs Work OS as a standalone cloud app', () => {
  const value = manifest();
  assert.equal(value.name, 'Work OS 2.0');
  assert.equal(value.short_name, 'Work OS');
  assert.equal(value.start_url, '/');
  assert.equal(value.scope, '/');
  assert.equal(value.display, 'standalone');
  assert.equal(value.theme_color, '#111111');
  assert.ok(Array.isArray(value.icons));
  assert.ok(value.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(value.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(value.icons.some((icon) => icon.purpose === 'maskable'));
});

void test('manifest never requests fullscreen or browserless navigation tricks', () => {
  const value = manifest();
  assert.notEqual(value.display, 'fullscreen');
  assert.equal(value.start_url, '/');
});
