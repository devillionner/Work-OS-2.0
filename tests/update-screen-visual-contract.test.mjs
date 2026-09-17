import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('update screen keeps one visual hierarchy and one motion rhythm', () => {
  const motion = read('app/update-motion.css');

  assert.match(motion, /--app-update-spinner-duration:\s*1440ms/);
  assert.match(motion, /\.app-update-pulse\s*\{[\s\S]*animation:\s*none/);
  assert.match(motion, /\.app-update-card::before\s*\{[\s\S]*content:\s*none/);
  assert.match(motion, /\.app-update-card \.eyebrow\s*\{[\s\S]*display:\s*none/);
  assert.match(motion, /app-update-card\[data-phase='updating'\] \.app-update-icon::before/);
  assert.match(motion, /data-work-os-update-boot='1'/);
  assert.match(motion, /app-update-spinner-turn/);
  assert.match(motion, /app-update-glyph-enter/);
  assert.match(motion, /\.app-update-icon \.is-spinning,[\s\S]*\.app-update-boot-spinner[\s\S]*animation:\s*none !important/);
});

void test('preview-only metadata stays outside the update card', () => {
  const motion = read('app/update-motion.css');
  const preview = read('components/app-update-screen-preview.tsx');

  assert.match(preview, /aria-labelledby="app-update-preview-title"/);
  assert.match(motion, /app-update-backdrop\[aria-labelledby='app-update-preview-title'\] \.app-update-note/);
  assert.match(motion, /display:\s*none/);
  assert.match(motion, /Тестовий режим · без перезавантаження/);
});

void test('completed update steps remain quieter than the active step', () => {
  const motion = read('app/update-motion.css');

  assert.match(motion, /\.app-update-steps li\.is-current > span\s*\{[\s\S]*scale\(1\.04\)/);
  assert.match(motion, /\.app-update-steps li\.is-complete\s*\{[\s\S]*#39745f/);
  assert.match(motion, /\.app-update-steps li\.is-complete > span\s*\{[\s\S]*#f3faf6/);
});
