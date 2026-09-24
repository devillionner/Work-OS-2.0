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

void test('quota-safe code-only deploy allows only a migration-free diff from exact deployed staging build', async () => {
  const { verifyQuotaSafeCodeOnlyDeploy } = await import('../scripts/staging-migration-preflight.mjs');
  const deployed='1111111111111111111111111111111111111111';
  const current='2222222222222222222222222222222222222222';
  const responses=[
    {ok:true,json:async()=>({buildId:deployed,version:'0.2.57'})},
    {ok:true,json:async()=>({status:'ahead',files:[
      {filename:'components/platform-workspace.tsx'},
      {filename:'app/globals.css'},
    ]})},
  ];
  const result=await verifyQuotaSafeCodeOnlyDeploy({
    currentSha:current,
    stagingBuildUrl:'https://staging.example/api/build',
    repository:'owner/repo',
    fetcher:async()=>responses.shift(),
  });
  assert.deepEqual(result,{
    allowed:true,reason:'code_only_since_deployed_staging',deployedBuildId:deployed,migrationFiles:[],
  });
});

void test('quota-safe fallback refuses deploy when any migration changed since deployed staging', async () => {
  const { verifyQuotaSafeCodeOnlyDeploy } = await import('../scripts/staging-migration-preflight.mjs');
  const deployed='1111111111111111111111111111111111111111';
  const current='2222222222222222222222222222222222222222';
  const responses=[
    {ok:true,json:async()=>({buildId:deployed})},
    {ok:true,json:async()=>({status:'ahead',files:[
      {filename:'migrations/0038_whatsapp_autopost_jobs.sql'},
      {filename:'components/platform-workspace.tsx'},
    ]})},
  ];
  const result=await verifyQuotaSafeCodeOnlyDeploy({
    currentSha:current,
    stagingBuildUrl:'https://staging.example/api/build',
    repository:'owner/repo',
    fetcher:async()=>responses.shift(),
  });
  assert.equal(result.allowed,false);
  assert.equal(result.reason,'migration_delta_present');
  assert.deepEqual(result.migrationFiles,['migrations/0038_whatsapp_autopost_jobs.sql']);
});
