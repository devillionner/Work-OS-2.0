// Знімки невідомих станів (3.18.0): скріншот і дерево екрана в ~/.local/state/work-os/failures/<дата>-<платформа>-<код>/, щоб власник
// міг одразу передати їх на виправлення. Зберігаються 14 днів і не більше 200 МБ; «нові» — ті, що новіші за позначку `.seen`
// (її ставить пункт меню трея «Нові збої»).
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEEP_MS = 14 * 24 * 3600_000;
const MAX_BYTES = 200 * 1024 * 1024;

export const failuresDir = () => join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'work-os', 'failures');

const safe = (value) => String(value || 'unknown').replace(/[^\w.-]+/gu, '_').slice(0, 60);

function folderSize(dir) {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      total += stat.isDirectory() ? folderSize(full) : stat.size;
    }
  } catch { /* тека зникла */ }
  return total;
}

/** Старші за 14 днів і все, що понад 200 МБ (найстаріші першими), видаляється. */
export function pruneFailures(now = Date.now()) {
  const root = failuresDir();
  if (!existsSync(root)) return;
  const items = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const full = join(root, name);
    try { const stat = statSync(full); if (stat.isDirectory()) items.push({ full, mtime: stat.mtimeMs, size: folderSize(full) }); } catch { /* ігноруємо */ }
  }
  items.sort((a, b) => a.mtime - b.mtime);
  let total = items.reduce((sum, item) => sum + item.size, 0);
  for (const item of items) {
    if (now - item.mtime > KEEP_MS || total > MAX_BYTES) { rmSync(item.full, { recursive: true, force: true }); total -= item.size; }
  }
}

/**
 * @param {{platform:string, code:string, png?:Buffer|null, tree?:string, detail?:string, extra?:Record<string,unknown>}} input
 * @returns {string} шлях до теки знімка (порожній рядок, якщо записати не вдалося)
 */
export function saveFailureSnapshot({ platform, code, png = null, tree = '', detail = '', extra = {} }) {
  try {
    const now = new Date();
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, '-')}`;
    const dir = join(failuresDir(), `${stamp}-${safe(platform)}-${safe(code)}`);
    mkdirSync(dir, { recursive: true });
    if (png && png.length > 100) writeFileSync(join(dir, 'screen.png'), png);
    if (tree) writeFileSync(join(dir, 'tree.txt'), String(tree).slice(0, 400_000));
    writeFileSync(join(dir, 'info.json'), JSON.stringify({ platform, code, detail: String(detail).slice(0, 2000), at: now.toISOString(), ...extra }, null, 2));
    pruneFailures();
    return dir;
  } catch { return ''; }
}
