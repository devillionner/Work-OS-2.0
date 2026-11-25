// Блокування сну ноутбука, поки runner виконує автопост: партія (Telegram 59 чатів при 30/год ≈ 2 год) довша за автопризупинення системи,
// а сон обриває runner посеред партії. Тримаємо inhibitor logind (`sleep:idle`, режим block) дочірнім процесом `systemd-inhibit`, який живе,
// поки потрібно. Екран гаснути може, обробку кришки (handle-lid-switch) не чіпаємо. Без systemd-inhibit чи logind мовчки пропускаємо (один рядок у журналі).
// Windows: дочірній Windows PowerShell тримає `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` і сам завершується, коли зникає runner
// (`powercfg /requests` тоді показує запит у розділі SYSTEM). Закриття кришки визначає схема живлення, а не цей запит.
import { spawn } from 'node:child_process';

export const INHIBIT_WHO = 'Work OS';
export const INHIBIT_WHY = 'Іде автопост';

/** Скрипт для Windows PowerShell: ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001) живе, поки живий потік і runner. */
export function windowsInhibitCommand(pid) {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Add-Type -Namespace WorkOs -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'`,
    '[void][WorkOs.Power]::SetThreadExecutionState([uint32]2147483649)',
    `while (Get-Process -Id ${Number(pid)}) { Start-Sleep -Seconds 5 }`,
  ].join('\n');
  return ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

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
    const windows = process.platform === 'win32';
    const args = windows ? windowsInhibitCommand(pid) : ['--what=sleep:idle', `--who=${INHIBIT_WHO}`, `--why=${INHIBIT_WHY}`, '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'];
    let spawned;
    try { spawned = windows ? spawnFn('powershell.exe', args, { stdio: 'ignore', windowsHide: true }) : spawnFn('systemd-inhibit', args, { stdio: 'ignore', detached: true }); }
    catch { unavailable = true; log(`Блокування сну недоступне: ${windows ? 'powershell.exe' : 'systemd-inhibit'} не запускається. Пропускаю.`); return; }
    child = spawned;
    const startedAt = Date.now();
    spawned.on('error', () => {
      if (child === spawned) child = null;
      unavailable = true; set(false);
      log(`Блокування сну недоступне: немає ${windows ? 'powershell.exe' : 'systemd-inhibit'}. Пропускаю.`);
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
    try { if (process.platform === 'win32') throw new Error('без груп процесів'); process.kill(-stopping.pid, 'SIGTERM'); } catch { try { stopping.kill('SIGTERM'); } catch { /* уже завершився */ } }
    set(false);
  }

  return {
    get active() { return state.active; },
    sync(want) { if (want) acquire(); else release(); },
    release,
  };
}
