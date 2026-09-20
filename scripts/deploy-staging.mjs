import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { parseStagingMigrationList } from './staging-migration-preflight.mjs';

const configPath = 'dist/server/wrangler.json';
const sourceConfigPath = 'wrangler.jsonc';
const expected = {
  worker: 'work-os-2-staging',
  database: 'work-os-2-staging-db',
  databaseId: '740312bc-bd1f-4d69-826f-d31208789598',
};

if (process.env.CLOUDFLARE_ENV === 'production') {
  throw new Error('Refusing staging deploy with CLOUDFLARE_ENV=production.');
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
const db = databases.find((item) => item?.binding === 'DB');

if (config.name !== expected.worker) {
  throw new Error('Refusing deploy: worker is ' + (config.name ?? '<missing>') + ', expected ' + expected.worker + '.');
}

if (!db || db.database_name !== expected.database || db.database_id !== expected.databaseId) {
  throw new Error('Refusing deploy: DB binding is not the staging D1 database.');
}

if (!process.env.npm_execpath) {
  throw new Error('Run this through npm run deploy:staging.');
}

const wranglerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const migrationCheck = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    'exec',
    '--',
    'wrangler',
    'd1',
    'migrations',
    'list',
    expected.database,
    '--remote',
    '--config',
    sourceConfigPath,
  ],
  { encoding: 'utf8', env: wranglerEnv, shell: false },
);

if (migrationCheck.stdout) process.stdout.write(migrationCheck.stdout);
if (migrationCheck.stderr) process.stderr.write(migrationCheck.stderr);
if (migrationCheck.error) throw migrationCheck.error;
if (migrationCheck.status !== 0) {
  throw new Error('Refusing deploy: could not verify staging D1 migration state (exit ' + (migrationCheck.status ?? 'unknown') + ').');
}

const migrationState = parseStagingMigrationList((migrationCheck.stdout || '') + '\n' + (migrationCheck.stderr || ''));
if (migrationState.pending) {
  throw new Error(
    'Refusing deploy: staging D1 has unapplied migrations: ' + migrationState.names.join(', ') + '. ' +
    'Apply them manually to work-os-2-staging-db, then retry the build. Production was not touched.',
  );
}

console.log('Staging guard passed: ' + config.name + ' -> ' + db.database_name);
console.log('Staging migration preflight passed: no pending remote D1 migrations.');

const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'exec', '--', 'wrangler', 'deploy', '--config', configPath],
  { stdio: 'inherit', env: wranglerEnv, shell: false },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
