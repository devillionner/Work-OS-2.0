// Розгортання публічної демо-версії (воркер `work-os-demo`) конвеєром Workers Builds, без жодних команд власника:
//   збірка:      npm run build:demo   (CLOUDFLARE_ENV=demo npm run build)
//   розгортання: npm run deploy:demo  (цей файл)
// Робить по черзі: перевіряє, що зібрано саме демо; знаходить (або створює) базу `work-os-demo-db`; застосовує міграції
// ТІЛЬКИ до неї; засіває вигадані дані, якщо база порожня; розгортає воркер. Staging і production не чіпаються:
// ім'я воркера й бази перевіряються, а id staging/production відхиляються.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { DEMO_DB_NAME, DEMO_EMAIL, kyivMidnight } from '../lib/demo.ts';
import { demoSeedStatements } from './demo-seed.mjs';

const configPath = 'dist/server/wrangler.json';
const SENTINEL_ID = '00000000-0000-0000-0000-000000000000';
const PROTECTED_IDS = new Set(['740312bc-bd1f-4d69-826f-d31208789598', 'dbe3fce7-5c0c-4ae4-9497-dc236a4e8141']);

if (!process.env.npm_execpath) throw new Error('Запускайте через npm run deploy:demo.');
if (process.env.CLOUDFLARE_ENV && process.env.CLOUDFLARE_ENV !== 'demo') throw new Error(`Відмова: CLOUDFLARE_ENV=${process.env.CLOUDFLARE_ENV}, очікується demo.`);

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const db = (config.d1_databases ?? []).find((item) => item?.binding === 'DB');
const bindings = config.durable_objects?.bindings ?? [];
if (config.name !== 'work-os-demo') throw new Error(`Відмова: воркер ${config.name ?? '<немає>'}, очікується work-os-demo. Збірка має бути з CLOUDFLARE_ENV=demo (npm run build:demo).`);
if (config.vars?.DEMO_MODE !== '1') throw new Error('Відмова: у збірці немає DEMO_MODE=1.');
if (!db || db.database_name !== DEMO_DB_NAME) throw new Error('Відмова: прив’язка DB не вказує на work-os-demo-db.');
if (!bindings.some((item) => item.name === 'DEMO_GUARD' && item.class_name === 'DemoGuard') || !bindings.some((item) => item.name === 'OWNER_CHANNEL')) throw new Error('Відмова: немає Durable Object DEMO_GUARD або OWNER_CHANNEL.');
if ((config.r2_buckets ?? []).length) throw new Error('Відмова: демо не повинно мати R2.');
if (config.main !== 'worker-entry.js') throw new Error('Відмова: точка входу не worker-entry.js.');

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
function wrangler(args, { allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--', 'wrangler', ...args], { encoding: 'utf8', env, shell: false, maxBuffer: 256 << 20 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} завершився з кодом ${result.status}.`);
  }
  return result;
}
function jsonFrom(output) {
  const start = output.search(/[[{]/);
  if (start < 0) throw new Error('Очікувалась відповідь JSON від wrangler.');
  return JSON.parse(output.slice(start));
}

// 1. База: уже існує або створюється (потрібен токен із правом D1 Edit; інакше створіть її вручну й задайте DEMO_D1_ID).
function findDatabaseId() {
  if (process.env.DEMO_D1_ID) return process.env.DEMO_D1_ID;
  const list = jsonFrom(wrangler(['d1', 'list', '--json']).stdout);
  return list.find((item) => item.name === DEMO_DB_NAME)?.uuid ?? null;
}
let databaseId = findDatabaseId();
if (!databaseId) {
  console.log(`Бази ${DEMO_DB_NAME} ще немає: створюю.`);
  wrangler(['d1', 'create', DEMO_DB_NAME]);
  databaseId = findDatabaseId();
}
if (!databaseId || databaseId === SENTINEL_ID) throw new Error(`Не вдалося визначити id бази ${DEMO_DB_NAME}. Створіть її в Cloudflare (D1) і задайте змінну DEMO_D1_ID.`);
if (PROTECTED_IDS.has(databaseId)) throw new Error('Відмова: id бази збігається з staging або production.');

// 2. Конфіг збірки: справжній id замість заглушки (міграції лежать у корені репозиторію).
db.database_id = databaseId;
db.migrations_dir = resolve('migrations');
writeFileSync(configPath, `${JSON.stringify(config)}\n`, 'utf8');
console.log(`Демо-база ${DEMO_DB_NAME} (${databaseId}), воркер ${config.name}.`);

// 3. Міграції лише до демо-бази.
wrangler(['d1', 'migrations', 'apply', DEMO_DB_NAME, '--remote', '--config', configPath]);

// 4. Сид, якщо база порожня; чужі користувачі в базі — зупинка.
const users = jsonFrom(wrangler(['d1', 'execute', DEMO_DB_NAME, '--remote', '--config', configPath, '--json', '--command', 'SELECT email FROM users LIMIT 3']).stdout);
const emails = (users[0]?.results ?? []).map((row) => row.email);
if (emails.some((email) => email !== DEMO_EMAIL)) throw new Error('Відмова: у базі є користувачі, які не є демонстраційними. Розгортання зупинено.');
if (!emails.length) {
  const midnight = String(kyivMidnight(Date.now()));
  const file = join(mkdtempSync(join(tmpdir(), 'work-os-demo-')), 'seed.sql');
  writeFileSync(file, demoSeedStatements().map((text) => `${text.replaceAll('@T', midnight)};`).join('\n'), 'utf8');
  console.log('База порожня: засіваю вигадані демо-дані.');
  wrangler(['d1', 'execute', DEMO_DB_NAME, '--remote', '--config', configPath, '--file', file]);
} else {
  console.log('Демо-дані вже є: сід не повторюється (нічний cron оновлює їх сам).');
}

// 5. Розгортання воркера.
const deploy = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--', 'wrangler', 'deploy', '--config', configPath], { stdio: 'inherit', env, shell: false });
if (deploy.error) throw deploy.error;
if (deploy.status !== 0) process.exit(deploy.status ?? 1);
