// Блокування сну ноутбука, поки runner виконує автопост: партія (Telegram 59 чатів при 30/год ≈ 2 год) довша за автопризупинення системи,
// а сон обриває runner посеред партії. Тримаємо inhibitor logind (`sleep:idle`, режим block) дочірнім процесом `systemd-inhibit`, який живе,
// поки потрібно. Екран гаснути може, обробку кришки (handle-lid-switch) не чіпаємо. Без systemd-inhibit чи logind мовчки пропускаємо (один рядок у журналі).
import { spawn } from 'node:child_process';

export const INHIBIT_WHO = 'Work OS';
export const INHIBIT_WHY = 'Іде автопост';

/**
 * @param {{ spawnFn?: typeof spawn, log?: (line: string) => void, onChange?: (active: boolean) => void, pid?: number }} [options]
 * `sync(want)` ставить або знімає блокування; повторні виклики з тим самим значенням нічого не роблять.
 */
export function createSleepInhibitor({ spawnFn = spawn, log = () => {}, onChange = () => {}, pid = process.pid } = {}) {
  let child = null;
  let unavailable = false;
  const state = { active: false };

  const set = (active) => { if (state.active !== active) { state.active = active; onChange(active); } };

  function acquire() {
    if (unavailable || child) return;
    // Утримувана команда сама завершується, коли помирає runner (`tail --pid`): навіть після SIGKILL блокування не лишиться назавжди.
    const args = ['--what=sleep:idle', `--who=${INHIBIT_WHO}`, `--why=${INHIBIT_WHY}`, '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'];
    let spawned;
    try { spawned = spawnFn('systemd-inhibit', args, { stdio: 'ignore', detached: true }); }
    catch { unavailable = true; log('Блокування сну недоступне: systemd-inhibit не запускається. Пропускаю.'); return; }
    child = spawned;
    const startedAt = Date.now();
    spawned.on('error', () => {
      if (child === spawned) child = null;
      unavailable = true; set(false);
      log('Блокування сну недоступне: немає systemd-inhibit. Пропускаю.');
    });
    spawned.on('exit', (code) => {
      if (child === spawned) child = null;
      set(false);
      // Негайний вихід із помилкою — logind недоступний (немає systemd, контейнер): не повторюємо.
      if (code !== 0 && code !== null && Date.now() - startedAt < 3000 && !unavailable) { unavailable = true; log('Блокування сну недоступне: logind не відповідає. Пропускаю.'); }
    });
    set(true);
  }

  function release() {
    if (!child) return;
    const stopping = child;
    child = null;
    try { process.kill(-stopping.pid, 'SIGTERM'); } catch { try { stopping.kill('SIGTERM'); } catch { /* уже завершився */ } }
    set(false);
  }

  return {
    get active() { return state.active; },
    sync(want) { if (want) acquire(); else release(); },
    release,
  };
}
