import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeGeneratedWranglerConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Wrangler config must be a JSON object.');
  }

  const normalized = { ...config };
  delete normalized.legacy_env;
  return normalized;
}

export async function normalizeGeneratedWranglerFile(
  filePath = 'dist/server/wrangler.json',
) {
  const raw = await readFile(filePath, 'utf8');
  const original = JSON.parse(raw);
  const normalized = normalizeGeneratedWranglerConfig(original);
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
