import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Cloudflare staging should build the app, not spend every push running the entire
// repository test suite. Full checks remain available via npm run lint,
// npm run typecheck and npm run test:full when they are intentionally needed.
if (!process.env.npm_execpath) throw new Error('Run through npm run verify.');

const localEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
delete localEnv.CLOUDFLARE_ENV;
for (const key of Object.keys(localEnv)) {
  if (/^(CLOUDFLARE_|CF_)/.test(key) && /(TOKEN|KEY|EMAIL)$/.test(key)) delete localEnv[key];
}

const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  env: localEnv,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(`[verify] build failed with status ${result.status ?? 'unknown'}${result.signal ? ` (signal ${result.signal})` : ''}`);
  process.exit(result.status ?? 1);
}
console.log('[verify] build passed');
