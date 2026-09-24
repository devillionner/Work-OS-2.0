import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { isD1DailyRowReadLimit, parseStagingMigrationList, verifyQuotaSafeMigrationFingerprint } from './staging-migration-preflight.mjs';

const configPath = 'dist/server/wrangler.json';
const sourceConfigPath = 'wrangler.jsonc';
const stagingBuildUrl = 'https://work-os-2-staging.devillionner.workers.dev/api/build';
const expected = {
  worker: 'work-os-2-staging',
  database: 'work-os-2-staging-db',
  databaseId: '740312bc-bd1f-4d69-826f-d31208789598',
};

const knownMigrationBaselines = {
  '8a6a06cfe00dcfa652a7582db6f6a19247a79a45': '640ab66af09ac341fff5684db0baf556fe63f1491c6bf97a88488e91d51616f5',
};

function currentMigrationFingerprint() {
  const entries = readdirSync('migrations', { withFileTypes:true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const path = `migrations/${entry.name}`;
      const bytes = readFileSync(path);
      const blobSha = createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex');
      return `${path}:${blobSha}`;
    })
    .sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

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
const migrationOutput = (migrationCheck.stdout || '') + '\n' + (migrationCheck.stderr || '');
let quotaSafeCodeOnlyDeploy = false;
if (migrationCheck.status !== 0) {
  if (!isD1DailyRowReadLimit(migrationOutput)) {
    throw new Error('Refusing deploy: could not verify staging D1 migration state (exit ' + (migrationCheck.status ?? 'unknown') + ').');
  }

  const currentFingerprint = currentMigrationFingerprint();
  const fallback = await verifyQuotaSafeMigrationFingerprint({
    currentFingerprint,
    stagingBuildUrl,
    knownBaselines: knownMigrationBaselines,
  });
  if (!fallback.allowed) {
    throw new Error(
      'Refusing deploy: staging D1 daily row-read quota is exhausted and migration fingerprint fallback is unsafe (' +
        fallback.reason +
        '). Production was not touched.',
    );
  }
  quotaSafeCodeOnlyDeploy = true;
  console.log(
    'Staging D1 daily row-read quota is exhausted, but migration fingerprint matches deployed staging build ' +
      fallback.deployedBuildId +
      '. Migration preflight bypass is allowed for this build.',
  );
}

let migrationState = quotaSafeCodeOnlyDeploy
  ? { pending: false, names: [] }
  : parseStagingMigrationList(migrationOutput);
if (migrationState.pending) {
  console.log(
    'Applying pending migrations to exact staging D1 only: ' + migrationState.names.join(', ') + '.',
  );
  const migrationApply = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'exec',
      '--',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      expected.database,
      '--remote',
      '--config',
      sourceConfigPath,
    ],
    { encoding: 'utf8', env: { ...wranglerEnv, CI: '1' }, shell: false },
  );
  if (migrationApply.stdout) process.stdout.write(migrationApply.stdout);
  if (migrationApply.stderr) process.stderr.write(migrationApply.stderr);
  if (migrationApply.error) throw migrationApply.error;
  if (migrationApply.status !== 0) {
    throw new Error(
      'Refusing deploy: automatic staging D1 migration failed (exit ' +
        (migrationApply.status ?? 'unknown') +
        '). Production was not touched.',
    );
  }

  const migrationRecheck = spawnSync(
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
  if (migrationRecheck.stdout) process.stdout.write(migrationRecheck.stdout);
  if (migrationRecheck.stderr) process.stderr.write(migrationRecheck.stderr);
  if (migrationRecheck.error) throw migrationRecheck.error;
  if (migrationRecheck.status !== 0) {
    throw new Error('Refusing deploy: could not re-check staging D1 migration state.');
  }
  migrationState = parseStagingMigrationList(
    (migrationRecheck.stdout || '') + '\n' + (migrationRecheck.stderr || ''),
  );
  if (migrationState.pending) {
    throw new Error(
      'Refusing deploy: staging D1 still has unapplied migrations after apply: ' +
        migrationState.names.join(', ') +
        '. Production was not touched.',
    );
  }
}

console.log('Staging guard passed: ' + config.name + ' -> ' + db.database_name);
console.log(quotaSafeCodeOnlyDeploy
  ? 'Staging migration preflight: quota-safe code-only fallback verified against deployed build identity.'
  : 'Staging migration preflight passed: no pending remote D1 migrations.');

const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'exec', '--', 'wrangler', 'deploy', '--config', configPath],
  { stdio: 'inherit', env: wranglerEnv, shell: false },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
