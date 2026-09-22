import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

void test('release version is aligned across app and package metadata', () => {
  const appMeta = readFileSync(join(root,'lib','app-meta.ts'),'utf8');
  const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const lock = JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
  const match = appMeta.match(/APP_VERSION = '([^']+)'/);
  assert.ok(match);
  assert.equal(match[1],pkg.version);
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
});

void test('current release date matches the release day', () => {
  const appMeta = readFileSync(join(root,'lib','app-meta.ts'),'utf8');
  assert.match(appMeta,/APP_RELEASE_DATE = '2026-09-22'/);
});
