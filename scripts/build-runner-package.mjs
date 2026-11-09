// Пакет runner для встановлення й автооновлення з сайту: лише файли runner (без коду сайту, документації й міграцій) того самого збирання, що й сайт.
// Кладе в public/runner/: runner.tar.gz, runner.sha256 (SHA-256) і manifest.json; vinext копіює public/ у збірку, тож пакет віддає той самий воркер.
// Склад визначається самим кодом: вхідний файл runner і все, що він імпортує (відносні імпорти), плюс фіксований перелік службових файлів.
// Збірка детермінована (порядок імен, mtime=0, власник 0, gzip -n): той самий код дає ту саму суму.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = 'scripts/chat-discovery-runner.mjs';
// Службові файли, яких не видно в імпортах: запуск, трей, обробники посилань, інсталятор, діалог пароля, лікар середовища, версія.
const EXTRA = [
  'scripts/whatsapp-runner.sh', 'scripts/work-os-runner-tray.py', 'scripts/work-os-runner-launch.sh', 'scripts/work-os-waydroid-show.sh',
  'scripts/install-whatsapp-runner-autostart.sh', 'scripts/install-runner.sh', 'scripts/runner-doctor.mjs', 'scripts/work-os-runner-dialog.py',
  'lib/app-meta.ts',
];
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

export function collectRunnerFiles() {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    if (!existsSync(join(root, rel))) throw new Error(`немає файлу runner: ${rel}`);
    seen.add(rel);
    if (!/\.(mjs|js|ts)$/.test(rel)) return;
    const text = readFileSync(join(root, rel), 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) visit(normalize(join(dirname(rel), match[1])));
  };
  visit(entry);
  for (const rel of EXTRA) visit(rel);
  return [...seen].sort();
}

export function buildRunnerPackage(outDir = join(root, 'public', 'runner')) {
  const files = collectRunnerFiles();
  const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(root, 'lib/app-meta.ts'), 'utf8'))?.[1];
  if (!version) throw new Error('не знайшов APP_VERSION у lib/app-meta.ts');
  const stage = mkdtempSync(join(tmpdir(), 'wos-runner-pack-'));
  try {
    for (const rel of files) {
      const target = join(stage, rel);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, rel), target);
      chmodSync(target, statSync(join(root, rel)).mode & 0o755 | 0o644);
    }
    writeFileSync(join(stage, 'RUNNER-PACKAGE.json'), JSON.stringify({ version, files }));
    mkdirSync(outDir, { recursive: true });
    const archive = join(outDir, 'runner.tar.gz');
    const pack = spawnSync('sh', ['-c', `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - -C "${stage}" . | gzip -n -9 > "${archive}"`], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (pack.status !== 0) throw new Error('не вдалося зібрати пакет (потрібен GNU tar і gzip)');
    const data = readFileSync(archive);
    const sha256 = createHash('sha256').update(data).digest('hex');
    writeFileSync(join(outDir, 'runner.sha256'), `${sha256}  runner.tar.gz\n`);
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ version, size: data.length, sha256, files: files.length }));
    return { version, size: data.length, sha256, files };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = buildRunnerPackage();
  console.log(`Пакет runner ${result.version}: ${result.files.length} файлів, ${(result.size / 1024).toFixed(0)} КБ, sha256 ${result.sha256.slice(0, 12)}…`);
}
