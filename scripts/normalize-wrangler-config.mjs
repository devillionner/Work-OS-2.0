import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// vinext always builds to "index.js" with only a default (fetch-handler) export — it has no idea
// about the Durable Object class this app also needs the Worker to export. worker-entry.js (written
// by writeWorkerEntryWrapper below, colocated with index.js at build time) re-exports both from one
// file, and becomes the new "main" so wrangler deploys that instead of the bare vinext output.
const WORKER_ENTRY_FILENAME = 'worker-entry.js';
const OWNER_CHANNEL_FILENAME = 'owner-channel.js';
// vinext configures Wrangler with "no_bundle": true, so dist/server is uploaded as separate ES
// modules with no bundling step — an import reaching outside that directory (e.g. back into the
// repo's workers/ source folder) is rejected by the Workers upload API ("Invalid module
// specifier"). The Durable Object source must therefore be copied into dist/server, not referenced
// in place.
const ownerChannelSourcePath = fileURLToPath(new URL('../workers/owner-channel.js', import.meta.url));

export function normalizeGeneratedWranglerConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Wrangler config must be a JSON object.');
  }

  const normalized = { ...config };
  delete normalized.legacy_env;
  if (normalized.main === 'index.js') normalized.main = WORKER_ENTRY_FILENAME;
  return normalized;
}

export function workerEntryWrapperSource() {
  return `import app from './index.js';\nexport { OwnerChannel } from './${OWNER_CHANNEL_FILENAME}';\nexport default app;\n`;
}

export async function writeWorkerEntryWrapper(serverDir) {
  await writeFile(path.join(serverDir, WORKER_ENTRY_FILENAME), workerEntryWrapperSource(), 'utf8');
  const ownerChannelSource = await readFile(ownerChannelSourcePath, 'utf8');
  await writeFile(path.join(serverDir, OWNER_CHANNEL_FILENAME), ownerChannelSource, 'utf8');
}

export async function normalizeGeneratedWranglerFile(
  filePath = 'dist/server/wrangler.json',
) {
  const raw = await readFile(filePath, 'utf8');
  const original = JSON.parse(raw);
  const normalized = normalizeGeneratedWranglerConfig(original);
  if (original.main === 'index.js') await writeWorkerEntryWrapper(path.dirname(filePath));
  const next = `${JSON.stringify(normalized)}\n`;
  if (next === raw || next.trim() === raw.trim()) return false;
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
