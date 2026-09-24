import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { isD1DailyRowReadLimit, migrationFilesFromComparison, parseStagingMigrationList, verifyQuotaSafeCodeOnlyDeploy } from './staging-migration-preflight.mjs';

const configPath = 'dist/server/wrangler.json';
const sourceConfigPath = 'wrangler.jsonc';
const stagingBuildUrl = 'https://work-os-2-staging.devillionner.workers.dev/api/build';
const expected = {
  worker: 'work-os-2-staging',
  database: 'work-os-2-staging-db',
  databaseId: '740312bc-bd1f-4d69-826f-d31208789598',
};

function runGit(args) {
  return spawnSync('git', args, { encoding:'utf8', shell:false });
}

function ensureCommitAvailable(sha) {
  const probe = runGit(['cat-file','-e',sha + '^{commit}']);
  if (probe.status === 0) return {ok:true};
  const fetchResult = runGit(['fetch','--no-tags','--depth=128','origin',sha]);
  if (fetchResult.stdout) process.stdout.write(fetchResult.stdout);
  if (fetchResult.stderr) process.stderr.write(fetchResult.stderr);
  if (fetchResult.error) return {ok:false,reason:'git_fetch_failed'};
  if (fetchResult.status !== 0) return {ok:false,reason:'git_fetch_failed'};
  const recheck = runGit(['cat-file','-e',sha + '^{commit}']);
  return recheck.status === 0 ? {ok:true} : {ok:false,reason:'deployed_commit_not_in_checkout'};
}

async function compareLocalGitCommits({deployedBuildId,currentSha}) {
  const available = ensureCommitAvailable(deployedBuildId);
  if (!available.ok) return {ok:false,reason:available.reason,files:[],migrationFiles:[]};

  const currentAvailable = ensureCommitAvailable(currentSha);
  if (!currentAvailable.ok) return {ok:false,reason:'current_commit_not_in_checkout',files:[],migrationFiles:[]};

  const ancestor = runGit(['merge-base','--is-ancestor',deployedBuildId,currentSha]);
  if (ancestor.error) return {ok:false,reason:'git_ancestor_check_failed',files:[],migrationFiles:[]};
  if (ancestor.status !== 0) return {ok:false,reason:'staging_not_ancestor_of_build',files:[],migrationFiles:[]};

  const diff = runGit(['diff','--name-only',deployedBuildId + '..' + currentSha]);
  if (diff.error || diff.status !== 0) {
    return {ok:false,reason:'git_diff_failed',files:[],migrationFiles:[]};
  }
  const files = String(diff.stdout || '').split(/\r?\n/u).map(value=>value.trim()).filter(Boolean);
  return {ok:true,files,migrationFiles:migrationFilesFromComparison(files)};
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

  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', shell: false });
  if (gitHead.error) throw gitHead.error;
  const currentSha = gitHead.status === 0 ? String(gitHead.stdout || '').trim() : '';
  const fallback = await verifyQuotaSafeCodeOnlyDeploy({
    currentSha,
    stagingBuildUrl,
    compareCommits: compareLocalGitCommits,
  });
  if (!fallback.allowed) {
    const migrationDetail = fallback.migrationFiles.length
      ? ' Pending code contains migration changes: ' + fallback.migrationFiles.join(', ') + '.'
      : '';
    throw new Error(
      'Refusing deploy: staging D1 daily row-read quota is exhausted and code-only fallback is unsafe (' +
        fallback.reason +
        ').' +
        migrationDetail +
        ' Production was not touched.',
    );
  }
  quotaSafeCodeOnlyDeploy = true;
  console.log(
    'Staging D1 daily row-read quota is exhausted, but deploy is code-only since deployed staging build ' +
      fallback.deployedBuildId +
      '. Migration preflight bypass is allowed for this build only.',
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
