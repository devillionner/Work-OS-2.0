import { spawnSync } from 'node:child_process';
import process from 'node:process';

// npm supplies its JS entry point, avoiding shell-dependent quoting on Windows.
if (!process.env.npm_execpath) throw new Error('Run through npm run verify.');
const localEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
delete localEnv.CLOUDFLARE_ENV;
for (const key of Object.keys(localEnv)) {
  if (/^(CLOUDFLARE_|CF_)/.test(key) && /(TOKEN|KEY|EMAIL)$/.test(key)) delete localEnv[key];
}
for (const script of ['lint', 'typecheck', 'test', 'build']) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], {
    env: localEnv, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[verify] ${script} failed with status ${result.status ?? 'unknown'}${result.signal ? ` (signal ${result.signal})` : ''}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[verify] ${script} passed`);
}
