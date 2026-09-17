import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('automatic update screen uses one coherent motion rhythm', () => {
  const source = read('components/pwa-registration.tsx');
  const css = read('app/update-motion.css');

  assert.match(source, /const UPDATE_STEP_HOLD_MS = 1_150/);
  assert.match(source, /const UPDATE_FINISH_HOLD_MS = 1_900/);
  assert.match(source, /const UPDATE_EXIT_MS = 620/);
  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /wait\(UPDATE_STEP_HOLD_MS\)/);
  assert.match(source, /app-update-status-mark/);
  assert.match(source, /app-update-status-brand/);
  assert.match(source, /app-update-status-check/);
  assert.doesNotMatch(source, /LoaderCircle/);
  assert.doesNotMatch(source, /className="app-update-brand"/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuenow=\{progress\}/);
  assert.match(source, /aria-live="polite"/);

  assert.match(css, /--app-update-motion-duration:\s*520ms/);
  assert.match(css, /--app-update-exit-duration:\s*620ms/);
  assert.match(css, /--app-update-progress-duration:\s*800ms/);
  assert.match(css, /--app-update-spinner-duration:\s*1440ms/);
  assert.match(css, /\.app-update-status-mark::after/);
  assert.match(css, /\.app-update-backdrop\.is-exiting/);
  assert.match(css, /background-color:\s*rgb\(245 246 248 \/ 0\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

void test('Settings update preview matches the real motion and hierarchy', () => {
  const preview = read('components/app-update-screen-preview.tsx');
  const css = read('app/update-motion.css');

  assert.match(preview, /const PREVIEW_STEP_HOLD_MS = 1_150/);
  assert.match(preview, /const PREVIEW_FINISH_HOLD_MS = 1_900/);
  assert.match(preview, /const PREVIEW_EXIT_MS = 620/);
  assert.match(preview, /PREVIEW_STEP_HOLD_MS \* 3/);
  assert.match(preview, /exitAt \+ PREVIEW_EXIT_MS/);
  assert.match(preview, /app-update-status-mark/);
  assert.match(preview, /app-update-status-brand/);
  assert.match(preview, /app-update-status-check/);
  assert.doesNotMatch(preview, /LoaderCircle/);
  assert.doesNotMatch(preview, /app-update-brand/);
  assert.doesNotMatch(preview, /app-update-icon/);
  assert.match(preview, /role="progressbar"/);
  assert.match(preview, /aria-valuenow=\{progress\}/);
  assert.match(css, /app-update-backdrop\[aria-labelledby='app-update-preview-title'\] \.app-update-note \{ display: none; \}/);
  assert.match(css, /Тестовий режим · без перезавантаження/);
  assert.doesNotMatch(preview, /location\.reload/);
});
