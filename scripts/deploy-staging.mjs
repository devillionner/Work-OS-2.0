import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const configPath = 'dist/server/wrangler.json';
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
  throw new Error(`Refusing deploy: worker is ${config.name ?? '<missing>'}, expected ${expected.worker}.`);
}

if (!db || db.database_name !== expected.database || db.database_id !== expected.databaseId) {
  throw new Error('Refusing deploy: DB binding is not the staging D1 database.');
}

if (!process.env.npm_execpath) {
  throw new Error('Run this through npm run deploy:staging.');
}

console.log(`Staging guard passed: ${config.name} -> ${db.database_name}`);

const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'exec', '--', 'wrangler', 'deploy', '--config', configPath],
  { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, shell: false },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
