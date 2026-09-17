import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('real update keeps a visual handoff across the full document reload', () => {
  const layout = read('app/layout.tsx');
  const cleanup = read('components/update-boot-handoff.tsx');
  const css = read('app/update-motion.css');

  assert.match(layout, /APP_BUILD_ID/);
  assert.match(layout, /work-os:pending-build/);
  assert.match(layout, /data-work-os-update-boot/);
  assert.match(layout, /app-update-boot-shell/);
  assert.match(layout, /UpdateBootHandoffCleanup/);

  assert.match(cleanup, /requestAnimationFrame/);
  assert.match(cleanup, /removeAttribute\('data-work-os-update-boot'\)/);

  assert.match(css, /\.app-update-boot-shell/);
  assert.match(css, /html\[data-work-os-update-boot='1'\]/);
  assert.match(css, /\.app-update-boot-spinner/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
