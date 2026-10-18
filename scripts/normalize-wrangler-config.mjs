import esbuild from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// vinext always builds to "index.js" with only a default (fetch-handler) export — it has no idea
// about the Durable Object class this app also needs the Worker to export. worker-entry.js (written
// by writeWorkerEntryWrapper below, colocated with index.js at build time) re-exports both from one
// file, and becomes the new "main" so wrangler deploys that instead of the bare vinext output.
const WORKER_ENTRY_FILENAME = 'worker-entry.js';
const OWNER_CHANNEL_FILENAME = 'owner-channel.js';
const LIVE_GATEWAY_FILENAME = 'live-gateway.js';
// vinext configures Wrangler with "no_bundle": true, so dist/server is uploaded as separate ES
// modules with no bundling step — an import reaching outside that directory (e.g. back into the
// repo's workers/ source folder, or into lib/chats/* TypeScript the Durable Object's business logic
// calls) is rejected by the Workers upload API ("Invalid module specifier"). owner-channel.js is
// therefore bundled with esbuild into one self-contained ES module (zero imports left pointing
// outside the file) before being written into dist/server, not referenced or copied in place.
const ownerChannelSourcePath = fileURLToPath(new URL('../workers/owner-channel.js', import.meta.url));
const liveGatewaySourcePath = fileURLToPath(new URL('../workers/live-gateway.js', import.meta.url));

export async function bundleOwnerChannel() {
  return bundleWorkerModule(ownerChannelSourcePath);
}

// Same self-contained bundling for the /api/live gateway that worker-entry.js calls before vinext.
export async function bundleLiveGateway() {
  return bundleWorkerModule(liveGatewaySourcePath);
}

// Публічна демо-версія: шлюз і сид підключаються лише збіркою з CLOUDFLARE_ENV=demo (див. workers/demo-gate.js).
// Сид рахується під час збірки й вшивається в модуль як звичайні дані, тож нічний cron лише виконує готові рядки.
const DEMO_GATE_FILENAME = 'demo-gate.js';
const demoGateSourcePath = fileURLToPath(new URL('../workers/demo-gate.js', import.meta.url));

export async function bundleDemoGate() {
  const { demoSeedStatements, WIPE_FIRST } = await import('./demo-seed.mjs');
  const seedData = `export default ${JSON.stringify({ statements: demoSeedStatements(), wipeFirst: WIPE_FIRST })};`;
  const seedPlugin = {
    name: 'demo-seed-data',
    setup(build) {
      build.onResolve({ filter: /^demo-seed-data$/ }, (args) => ({ path: args.path, namespace: 'demo-seed' }));
      build.onLoad({ filter: /.*/, namespace: 'demo-seed' }, () => ({ contents: seedData, loader: 'js' }));
    },
  };
  return bundleWorkerModule(demoGateSourcePath, [seedPlugin]);
}

async function bundleWorkerModule(entryPoint, plugins = []) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    plugins,
  });
  return result.outputFiles[0].text;
}

export function normalizeGeneratedWranglerConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Wrangler config must be a JSON object.');
  }

  const normalized = { ...config };
  delete normalized.legacy_env;
  if (normalized.main === 'index.js') normalized.main = WORKER_ENTRY_FILENAME;
  return normalized;
}

// /api/live is answered before vinext: vinext rebuilds every route Response and a 101 WebSocket
// upgrade cannot be reconstructed, so through a vinext route the client always got a 500 (see
// workers/live-gateway.js). Everything else goes to vinext unchanged.
export function workerEntryWrapperSource({ demo = false } = {}) {
  if (demo) {
    // Те саме, що й нижче, але кожен запит спершу проходить демо-шлюз; cron `scheduled` робить нічне скидання.
    return [
      `import app from './index.js';`,
      `import { handleLiveRequest } from './${LIVE_GATEWAY_FILENAME}';`,
      `import { demoFetch, demoScheduled } from './${DEMO_GATE_FILENAME}';`,
      `export { OwnerChannel } from './${OWNER_CHANNEL_FILENAME}';`,
      `export { DemoGuard } from './${DEMO_GATE_FILENAME}';`,
      `export default {`,
      `  ...app,`,
      `  fetch(request, env, ctx) {`,
      `    return demoFetch(request, env, (next) => {`,
      `      if (new URL(next.url).pathname === '/api/live') return handleLiveRequest(next, env);`,
      `      return app.fetch(next, env, ctx);`,
      `    });`,
      `  },`,
      `  scheduled(event, env, ctx) {`,
      `    ctx.waitUntil(demoScheduled(env));`,
      `  },`,
      `};`,
      ``,
    ].join('\n');
  }
  return [
    `import app from './index.js';`,
    `import { handleLiveRequest } from './${LIVE_GATEWAY_FILENAME}';`,
    `export { OwnerChannel } from './${OWNER_CHANNEL_FILENAME}';`,
    `export default {`,
    `  ...app,`,
    `  fetch(request, env, ctx) {`,
    `    if (new URL(request.url).pathname === '/api/live') return handleLiveRequest(request, env);`,
    `    return app.fetch(request, env, ctx);`,
    `  },`,
    `};`,
    ``,
  ].join('\n');
}

export async function writeWorkerEntryWrapper(serverDir, { demo = process.env.CLOUDFLARE_ENV === 'demo' } = {}) {
  await writeFile(path.join(serverDir, WORKER_ENTRY_FILENAME), workerEntryWrapperSource({ demo }), 'utf8');
  await writeFile(path.join(serverDir, OWNER_CHANNEL_FILENAME), await bundleOwnerChannel(), 'utf8');
  await writeFile(path.join(serverDir, LIVE_GATEWAY_FILENAME), await bundleLiveGateway(), 'utf8');
  if (demo) await writeFile(path.join(serverDir, DEMO_GATE_FILENAME), await bundleDemoGate(), 'utf8');
}

export async function normalizeGeneratedWranglerFile(
  filePath = 'dist/server/wrangler.json',
) {
  let raw;
  let fromSource = false;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      try {
        raw = await readFile('wrangler.jsonc', 'utf8');
        fromSource = true;
      } catch {
        raw = await readFile('wrangler.json', 'utf8');
        fromSource = true;
      }
    } else {
      throw err;
    }
  }
  const original = JSON.parse(raw);
  const normalized = normalizeGeneratedWranglerConfig(original);
  if (original.main === 'index.js' || fromSource) await writeWorkerEntryWrapper(path.dirname(filePath));
  if (fromSource) normalized.main = WORKER_ENTRY_FILENAME;
  const next = `${JSON.stringify(normalized)}\n`;
  if (!fromSource && (next === raw || next.trim() === raw.trim())) return false;
  await writeFile(filePath, next, 'utf8');
  return true;
}

const direct = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (direct) {
  const filePath = process.argv[2] || 'dist/server/wrangler.json';
  normalizeGeneratedWranglerFile(filePath)
    .then((changed) => {
      process.stdout.write(
        changed
          ? `Normalized ${filePath}\n`
          : `Wrangler config already normalized: ${filePath}\n`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
