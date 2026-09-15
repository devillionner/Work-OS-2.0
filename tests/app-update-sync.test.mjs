import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('build identity is compiled from Git and exposed through a no-store endpoint', () => {
  const vite = read('vite.config.ts');
  const buildId = read('lib/build-id.ts');
  const route = read('app/api/build/route.ts');

  assert.match(vite, /git', \['rev-parse', 'HEAD'\]/);
  assert.match(vite, /__WORK_OS_BUILD_ID__:\s*JSON\.stringify\(buildId\)/);
  assert.match(buildId, /export const APP_BUILD_ID/);
  assert.match(route, /buildId:\s*APP_BUILD_ID/);
  assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
});

void test('automatic app update detects a new build and preserves user context', () => {
  const source = read('components/pwa-registration.tsx');

  assert.match(source, /const BUILD_POLL_MS = 30_000/);
  assert.match(source, /fetch\(`\/api\/build\?t=\$\{Date\.now\(\)\}`/);
  assert.match(source, /new BroadcastChannel\(UPDATE_CHANNEL\)/);
  assert.match(source, /isEditing\(\)/);
  assert.match(source, /sessionStorage\.setItem\(PENDING_BUILD_KEY, targetBuildId\)/);
  assert.match(source, /sessionStorage\.setItem\(UPDATE_SCROLL_KEY/);
  assert.match(source, /sessionStorage\.setItem\(UPDATE_VIEW_KEY, activeView\)/);
  assert.match(source, /restoreActiveView\(savedView\)/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /Оновлюємо Work OS/);
  assert.match(source, /Work OS оновлено/);
});

void test('global server sync refreshes visible clients and sibling tabs', () => {
  const sync = read('components/server-sync.tsx');
  const clientSync = read('lib/client-sync.ts');
  const layout = read('app/layout.tsx');

  assert.match(sync, /const SERVER_SYNC_MS = 10_000/);
  assert.match(sync, /router\.refresh\(\)/);
  assert.match(sync, /new CustomEvent<DataSyncDetail>\(DATA_SYNC_EVENT/);
  assert.match(sync, /new BroadcastChannel\(DATA_SYNC_CHANNEL\)/);
  assert.match(sync, /visibilitychange/);
  assert.match(sync, /window\.addEventListener\('online'/);
  assert.match(clientSync, /announceDataChange/);
  assert.match(clientSync, /reason: 'local-write'/);
  assert.match(layout, /<ServerSync \/>/);
});

void test('lead writes broadcast fresh server state to other open clients', () => {
  const commands = read('lib/leads/client/commands.ts');
  assert.match(commands, /announceDataChange\('leads'\)/);
});

void test('automatic update UI has desktop, mobile and reduced-motion protection', () => {
  const css = read('app/design-polish.css');
  assert.match(css, /\.app-update-banner\s*\{/);
  assert.match(css, /\.app-update-backdrop\s*\{/);
  assert.match(css, /\.app-update-card\s*\{/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
