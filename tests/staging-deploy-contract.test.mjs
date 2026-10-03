import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/deploy-staging.mjs', import.meta.url), 'utf8');

void test('staging deploy auto-applies only exact staging D1 migrations before deploy', () => {
  assert.match(source, /worker: 'work-os-2-staging'/);
  assert.match(source, /database: 'work-os-2-staging-db'/);
  assert.match(source, /databaseId: '740312bc-bd1f-4d69-826f-d31208789598'/);
  assert.match(source, /CLOUDFLARE_ENV === 'production'/);
  assert.match(source, /Refusing staging deploy with CLOUDFLARE_ENV=production/);
  assert.match(source, /config\.name !== expected\.worker/);
  assert.match(source, /db\.database_name !== expected\.database \|\| db\.database_id !== expected\.databaseId/);
  assert.match(source, /durableObjectBinding: 'OWNER_CHANNEL'/);
  assert.match(source, /durableObjectClass: 'OwnerChannel'/);
  assert.match(source, /OWNER_CHANNEL Durable Object binding is missing or wrong/);
  assert.match(source, /config\.main !== 'worker-entry\.js'/);

  const listIndex = source.indexOf("'list'");
  const applyIndex = source.indexOf("'apply'");
  const recheckIndex = source.indexOf('migrationRecheck');
  const deployIndex = source.lastIndexOf("'deploy'");
  assert.ok(listIndex >= 0);
  assert.ok(applyIndex > listIndex);
  assert.ok(recheckIndex > applyIndex);
  assert.ok(deployIndex > recheckIndex);

  assert.match(source, /expected\.database,\s*'--remote',\s*'--config',\s*sourceConfigPath/s);
  assert.match(source, /env: \{ \.\.\.wranglerEnv, CI: '1' \}/);
  assert.match(source, /staging D1 still has unapplied migrations after apply/);
  assert.match(source, /Production was not touched/);
  assert.doesNotMatch(source, /--env['"],\s*['"]production/);
});
