import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('automatic update screen fades out before it is removed', () => {
  const source = read('components/pwa-registration.tsx');
  const css = read('app/update-motion.css');

  assert.match(source, /const UPDATE_FINISH_HOLD_MS = 950/);
  assert.match(source, /const UPDATE_EXIT_MS = 360/);
  assert.match(source, /setExiting\(true\)/);
  assert.match(source, /UPDATE_FINISH_HOLD_MS \+ UPDATE_EXIT_MS/);
  assert.match(source, /app-update-backdrop\$\{exiting \? ' is-exiting' : ''\}/);

  assert.match(css, /\.app-update-backdrop\.is-exiting/);
  assert.match(css, /\.app-update-backdrop\.is-exiting \.app-update-card/);
  assert.match(css, /app-update-screen-enter/);
  assert.match(css, /app-update-card-enter/);
  assert.match(css, /transition: width 520ms/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

void test('Settings update preview uses the same smooth exit contract', () => {
  const preview = read('components/app-update-screen-preview.tsx');

  assert.match(preview, /const PREVIEW_EXIT_MS = 360/);
  assert.match(preview, /setExiting\(true\)/);
  assert.match(preview, /3_250 \+ PREVIEW_EXIT_MS/);
  assert.match(preview, /app-update-backdrop\$\{exiting \? ' is-exiting' : ''\}/);
  assert.doesNotMatch(preview, /location\.reload/);
});
