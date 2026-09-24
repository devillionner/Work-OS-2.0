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
