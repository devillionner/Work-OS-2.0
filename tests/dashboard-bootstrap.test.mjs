import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('home SSR only authenticates and defers dashboard work to JSON bootstrap', async () => {
  const [page, bootstrap, route] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/work-os-bootstrap.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/dashboard-bootstrap/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /getCurrentUser\(\)/);
  assert.match(page, /<WorkOsBootstrap/);
  assert.doesNotMatch(page, /getDashboardSnapshot/);
  assert.doesNotMatch(page, /readSyncRevision/);
  assert.match(bootstrap, /fetch\('\/api\/dashboard-bootstrap'/);
  assert.match(route, /getDashboardSnapshot\(user\.id\)/);
  assert.match(route, /readSyncRevision\(env\.DB,user\.id\)/);
});
