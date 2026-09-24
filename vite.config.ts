import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

function resolveBuildId(): string {
  const explicit = process.env.WORK_OS_BUILD_ID?.trim() || process.env.GITHUB_SHA?.trim();
  if (explicit) return explicit;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'development';
  } catch {
    return 'development';
  }
}

function resolveMigrationFingerprint(): string {
  const entries = readdirSync('migrations', { withFileTypes: true })
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

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  const buildId = resolveBuildId();
  const migrationFingerprint = resolveMigrationFingerprint();

  return {
    define: {
      __WORK_OS_BUILD_ID__: JSON.stringify(buildId),
      __WORK_OS_MIGRATION_FINGERPRINT__: JSON.stringify(migrationFingerprint),
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        // Tests and local previews never connect resource bindings to Cloudflare.
        remoteBindings: false,
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      }),
    ],
  };
});
