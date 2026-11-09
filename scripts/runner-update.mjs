// Самооновлення runner, встановленого з сайту (є RUNNER-PACKAGE.json поруч): коли версія сайту інша, а runner простоює, він завантажує
// пакет із того ж сайту, звіряє SHA-256 і розкладає файли поверх своїх; трей бачить зміну файлів і сам перезапускає runner (лише коли він не працює).
// Runner із робочої копії репозиторію (немає RUNNER-PACKAGE.json) не чіпається: його оновлює трей за зміною файлів, як і раніше.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

export const PACKAGE_MARKER = 'RUNNER-PACKAGE.json';

export function readInstalledPackage(rootDir) {
  try { return JSON.parse(readFileSync(join(rootDir, PACKAGE_MARKER), 'utf8')); } catch { return null; }
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, base)); else files.push(relative(base, path));
  }
  return files;
}

/** Завантажує пакет, перевіряє суму й версію і розкладає файли поверх `rootDir`. Повертає нову версію або кидає помилку (нічого не змінивши до перевірки). */
export async function updateFromSite({ baseUrl, rootDir, expectedVersion, log = () => {} }) {
  const shaText = await (await fetch(`${baseUrl}/runner/runner.sha256`, { signal: AbortSignal.timeout(30000) })).text();
  const expected = /^([0-9a-f]{64})/.exec(shaText.trim())?.[1];
  if (!expected) throw new Error('немає контрольної суми пакета');
  const response = await fetch(`${baseUrl}/runner/runner.tar.gz`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`пакет недоступний (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('контрольна сума пакета не збігається');
  const tmp = mkdtempSync(join(tmpdir(), 'wos-runner-update-'));
  try {
    writeFileSync(join(tmp, 'runner.tar.gz'), data);
    mkdirSync(join(tmp, 'new'));
    const unpack = spawnSync('tar', ['-xzf', join(tmp, 'runner.tar.gz'), '-C', join(tmp, 'new')], { stdio: 'ignore' });
    if (unpack.status !== 0) throw new Error('пакет не розпакувався');
    const next = readInstalledPackage(join(tmp, 'new'));
    if (!next?.version || !existsSync(join(tmp, 'new', 'scripts', 'chat-discovery-runner.mjs'))) throw new Error('пакет неповний');
    if (expectedVersion && next.version !== expectedVersion) throw new Error(`у пакеті версія ${next.version}, а сайт каже ${expectedVersion}`);
    const old = readInstalledPackage(rootDir);
    const trayBefore = existsSync(join(rootDir, 'scripts/work-os-runner-tray.py')) ? readFileSync(join(rootDir, 'scripts/work-os-runner-tray.py')) : null;
    const files = walk(join(tmp, 'new'));
    for (const rel of files) {
      if (rel === PACKAGE_MARKER) continue;
      const target = join(rootDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      const staged = `${target}.new`;
      copyFileSync(join(tmp, 'new', rel), staged);
      chmodSync(staged, statSync(join(tmp, 'new', rel)).mode);
      renameSync(staged, target);
    }
    for (const rel of old?.files || []) if (!files.includes(rel)) { try { unlinkSync(join(rootDir, rel)); } catch { /* уже немає */ } }
    writeFileSync(join(rootDir, PACKAGE_MARKER), JSON.stringify(next));
    const trayAfter = readFileSync(join(rootDir, 'scripts/work-os-runner-tray.py'));
    if (trayBefore && !trayBefore.equals(trayAfter)) {
      // Сам трей змінився: перезапускаємо лише його (runner переживає: KillMode=process, новий трей його підхоплює).
      log('Оновився трей: перезапускаю сервіс трея.');
      spawn('systemctl', ['--user', 'restart', 'work-os-runner-tray.service'], { detached: true, stdio: 'ignore' }).unref();
    }
    return next.version;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
