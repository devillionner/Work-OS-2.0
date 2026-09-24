import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStagingMigrationList } from '../scripts/staging-migration-preflight.mjs';

void test('staging migration preflight accepts a fully migrated D1', () => {
  assert.deepEqual(
    parseStagingMigrationList('No migrations to apply!'),
    { pending: false, names: [] },
  );
});

void test('staging migration preflight reports every pending migration', () => {
  const state = parseStagingMigrationList([
    'Migrations to be applied:',
    '0030_migration_reconciliation.sql',
    '0031_chat_discovery.sql',
    '0031_chat_discovery.sql',
  ].join('\n'));

  assert.deepEqual(state, {
    pending: true,
    names: ['0030_migration_reconciliation.sql', '0031_chat_discovery.sql'],
  });
});

void test('staging migration preflight fails closed on unknown Wrangler output', () => {
  assert.throws(
    () => parseStagingMigrationList('Resource location: remote'),
    /Could not determine staging migration state/,
  );
});


void test('D1 daily row read quota errors are detected explicitly', async () => {
  const { isD1DailyRowReadLimit } = await import('../scripts/staging-migration-preflight.mjs');
  assert.equal(isD1DailyRowReadLimit("Your account has exceeded D1's free tier daily row read limit."), true);
  assert.equal(isD1DailyRowReadLimit('authentication failed'), false);
});

void test('quota-safe migration fingerprint accepts exact advertised staging fingerprint', async () => {
  const { verifyQuotaSafeMigrationFingerprint } = await import('../scripts/staging-migration-preflight.mjs');
  const fingerprint='640ab66af09ac341fff5684db0baf556fe63f1491c6bf97a88488e91d51616f5';
  const result=await verifyQuotaSafeMigrationFingerprint({
    currentFingerprint:fingerprint,
    stagingBuildUrl:'https://staging.example/api/build',
    fetcher:async()=>({ok:true,json:async()=>({
      buildId:'1111111111111111111111111111111111111111',
      migrationFingerprint:fingerprint,
    })}),
  });
  assert.equal(result.allowed,true);
  assert.equal(result.reason,'migration_fingerprint_match');
});

void test('quota-safe migration fingerprint supports one known pre-fingerprint staging baseline', async () => {
  const { verifyQuotaSafeMigrationFingerprint } = await import('../scripts/staging-migration-preflight.mjs');
  const buildId='8a6a06cfe00dcfa652a7582db6f6a19247a79a45';
  const fingerprint='640ab66af09ac341fff5684db0baf556fe63f1491c6bf97a88488e91d51616f5';
  const result=await verifyQuotaSafeMigrationFingerprint({
    currentFingerprint:fingerprint,
    stagingBuildUrl:'https://staging.example/api/build',
    knownBaselines:{[buildId]:fingerprint},
    fetcher:async()=>({ok:true,json:async()=>({buildId,version:'0.2.55'})}),
  });
  assert.equal(result.allowed,true);
  assert.equal(result.deployedBuildId,buildId);
});

void test('quota-safe migration fingerprint refuses any migration mismatch', async () => {
  const { verifyQuotaSafeMigrationFingerprint } = await import('../scripts/staging-migration-preflight.mjs');
  const result=await verifyQuotaSafeMigrationFingerprint({
    currentFingerprint:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    stagingBuildUrl:'https://staging.example/api/build',
    fetcher:async()=>({ok:true,json:async()=>({
      buildId:'1111111111111111111111111111111111111111',
      migrationFingerprint:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })}),
  });
  assert.equal(result.allowed,false);
  assert.equal(result.reason,'migration_fingerprint_mismatch');
});

void test('quota-safe migration fingerprint fails closed when old staging baseline is unknown', async () => {
  const { verifyQuotaSafeMigrationFingerprint } = await import('../scripts/staging-migration-preflight.mjs');
  const result=await verifyQuotaSafeMigrationFingerprint({
    currentFingerprint:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    stagingBuildUrl:'https://staging.example/api/build',
    fetcher:async()=>({ok:true,json:async()=>({buildId:'1111111111111111111111111111111111111111'})}),
  });
  assert.equal(result.allowed,false);
  assert.equal(result.reason,'staging_migration_fingerprint_unknown');
});
