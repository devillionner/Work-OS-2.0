import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeGeneratedWranglerConfig,
  normalizeGeneratedWranglerFile,
  workerEntryWrapperSource,
  writeWorkerEntryWrapper,
} from '../scripts/normalize-wrangler-config.mjs';

const OWNER_CHANNEL_BINDING = { name: 'OWNER_CHANNEL', class_name: 'OwnerChannel' };

void test('committed Wrangler config pins staging and production D1 separately', async () => {
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(config.name, 'work-os-2-staging');
  assert.deepEqual(config.d1_databases, [{
    binding: 'DB',
    database_name: 'work-os-2-staging-db',
    database_id: '740312bc-bd1f-4d69-826f-d31208789598',
    migrations_dir: 'migrations',
  }]);
  assert.equal(config.env.production.name, 'work-os-2');
  assert.deepEqual(config.env.production.d1_databases, [{
    binding: 'DB',
    database_name: 'work-os-production',
    database_id: 'dbe3fce7-5c0c-4ae4-9497-dc236a4e8141',
    migrations_dir: 'migrations',
  }]);
  // The DO binding is NOT inherited by env.production automatically (Wrangler config semantics),
  // so it must be declared explicitly in both places or production silently loses it.
  assert.deepEqual(config.durable_objects, { bindings: [OWNER_CHANNEL_BINDING] });
  assert.deepEqual(config.env.production.durable_objects, { bindings: [OWNER_CHANNEL_BINDING] });
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['OwnerChannel'] }]);
});

void test('generated Wrangler config drops only obsolete legacy_env', () => {
  const normalized = normalizeGeneratedWranglerConfig({
    name: 'work-os-2-staging',
    legacy_env: true,
    compatibility_date: '2026-09-02',
    d1_databases: [{ binding: 'DB' }],
  });
  assert.equal('legacy_env' in normalized, false);
  assert.equal(normalized.name, 'work-os-2-staging');
  assert.equal(normalized.compatibility_date, '2026-09-02');
  assert.deepEqual(normalized.d1_databases, [{ binding: 'DB' }]);
});

void test('generated Wrangler config repoints main at the OwnerChannel wrapper', () => {
  // vinext always builds to a bare "index.js" with only a default fetch export; wrangler needs the
  // Durable Object class exported from whatever "main" names, so it must become worker-entry.js.
  const normalized = normalizeGeneratedWranglerConfig({ name: 'work-os-2-staging', main: 'index.js' });
  assert.equal(normalized.main, 'worker-entry.js');
  // A config that was never vinext's bare output (no main, or already repointed) is left alone.
  assert.equal(normalizeGeneratedWranglerConfig({ name: 'x' }).main, undefined);
  assert.equal(normalizeGeneratedWranglerConfig({ name: 'x', main: 'worker-entry.js' }).main, 'worker-entry.js');
});

void test('worker entry wrapper re-exports both vinext\'s handler and a colocated copy of OwnerChannel', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-os-wrapper-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(directory, { recursive: true, force: true }); });
  await writeWorkerEntryWrapper(directory);
  const source = await readFile(path.join(directory, 'worker-entry.js'), 'utf8');
  assert.equal(source, workerEntryWrapperSource());
  assert.match(source, /import app from '\.\/index\.js';/);
  // Same-directory import, not a path reaching outside dist/server: vinext's "no_bundle" Wrangler
  // config uploads that directory as separate ES modules, and the Workers API rejects a module
  // specifier that escapes it ("Invalid module specifier") — confirmed live against staging.
  assert.match(source, /export \{ OwnerChannel \} from '\.\/owner-channel\.js';/);
  assert.match(source, /export default app;/);
  // The real class source must be copied alongside, not just referenced.
  const copied = await readFile(path.join(directory, 'owner-channel.js'), 'utf8');
  const original = await readFile(new URL('../workers/owner-channel.js', import.meta.url), 'utf8');
  assert.equal(copied, original);
  assert.match(copied, /export class OwnerChannel/);
});

void test('generated Wrangler file is normalized once and then stays stable', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-os-wrangler-'));
  const file = path.join(directory, 'wrangler.json');
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });

  await writeFile(file, JSON.stringify({
    name: 'work-os-2-staging',
    legacy_env: true,
    vars: { GOOGLE_CLIENT_ID: 'test-client' },
  }), 'utf8');

  assert.equal(await normalizeGeneratedWranglerFile(file), true);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  assert.equal('legacy_env' in parsed, false);
  assert.equal(parsed.name, 'work-os-2-staging');
  assert.deepEqual(parsed.vars, { GOOGLE_CLIENT_ID: 'test-client' });
  assert.equal(await normalizeGeneratedWranglerFile(file), false);
});

void test('normalizing a real vinext build output also writes the colocated worker entry wrapper', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'work-os-wrangler-build-'));
  const file = path.join(directory, 'wrangler.json');
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(directory, { recursive: true, force: true }); });

  await writeFile(file, JSON.stringify({ name: 'work-os-2-staging', main: 'index.js' }), 'utf8');
  assert.equal(await normalizeGeneratedWranglerFile(file), true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).main, 'worker-entry.js');
  assert.equal(await readFile(path.join(directory, 'worker-entry.js'), 'utf8'), workerEntryWrapperSource());
  assert.match(await readFile(path.join(directory, 'owner-channel.js'), 'utf8'), /export class OwnerChannel/);
});
