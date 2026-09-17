import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('automatic update screen uses one coherent motion rhythm', () => {
  const source = read('components/pwa-registration.tsx');
  const css = read('app/update-motion.css');

  assert.match(source, /const UPDATE_STEP_HOLD_MS = 1_150/);
  assert.match(source, /const UPDATE_FINISH_HOLD_MS = 1_900/);
  assert.match(source, /const UPDATE_EXIT_MS = 480/);
  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /wait\(UPDATE_STEP_HOLD_MS\)/);
  assert.match(source, /Math\.min\(75, Math\.max\(25, update\.step \* 25\)\)/);
  assert.match(source, /app-update-status-copy/);
  assert.match(source, /app-update-backdrop\$\{exiting \? ' is-exiting' : ''\}/);

  assert.match(css, /--app-update-motion-duration: 480ms/);
  assert.match(css, /--app-update-progress-duration: 800ms/);
  assert.match(css, /--app-update-ease: cubic-bezier\(\.22, \.61, \.36, 1\)/);
  assert.match(css, /\.app-update-backdrop\.is-exiting/);
  assert.match(css, /\.app-update-backdrop\.is-exiting \.app-update-card/);
  assert.match(css, /app-update-screen-enter/);
  assert.match(css, /app-update-card-enter/);
  assert.match(css, /app-update-copy-enter/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

void test('Settings update preview follows the same phase cadence', () => {
  const preview = read('components/app-update-screen-preview.tsx');

  assert.match(preview, /const PREVIEW_STEP_HOLD_MS = 1_150/);
  assert.match(preview, /const PREVIEW_FINISH_HOLD_MS = 1_900/);
  assert.match(preview, /const PREVIEW_EXIT_MS = 480/);
  assert.match(preview, /PREVIEW_STEP_HOLD_MS \* 3/);
  assert.match(preview, /exitAt \+ PREVIEW_EXIT_MS/);
  assert.match(preview, /Math\.min\(75, Math\.max\(25, step \* 25\)\)/);
  assert.match(preview, /app-update-status-copy/);
  assert.match(preview, /app-update-backdrop\$\{exiting \? ' is-exiting' : ''\}/);
  assert.doesNotMatch(preview, /location\.reload/);
});

void test('reload handoff fades at the same base pace instead of disappearing in two frames', () => {
  const cleanup = read('components/update-boot-handoff.tsx');
  const css = read('app/update-motion.css');

  assert.match(cleanup, /const UPDATE_BOOT_HANDOFF_DELAY_MS = 180/);
  assert.match(cleanup, /requestAnimationFrame/);
  assert.match(cleanup, /setTimeout/);
  assert.match(cleanup, /removeAttribute\('data-work-os-update-boot'\)/);
  assert.match(css, /\.app-update-boot-shell/);
  assert.match(css, /opacity var\(--app-update-motion-duration\) var\(--app-update-ease\)/);
});
