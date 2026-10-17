// Міст між runner (Node) і Linux-помічником Viber (scripts/viber-forward-helper.py, AT-SPI + Hyprland).
// Помічник завжди віддає один рядок JSON; тут лише запуск із жорстким таймаутом і нормалізація відповіді.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER_PATH = fileURLToPath(new URL('./viber-forward-helper.py', import.meta.url));
// Одна відправка триває 1–2 хвилини (відкриття чату, пошук нотатки, пересилання, підтвердження); це стеля, а не очікування.
const HELPER_TIMEOUT_MS = 6 * 60 * 1000;

/** Короткі пояснення для журналу й значка в треї; повні тексти для оператора живуть на сайті. */
export const VIBER_ENV_REASON_TEXT = {
  viber_not_running: 'Viber не запущений',
  accessibility_off: 'У Viber вимкнена доступність: перезапусти його з ярлика',
  viber_window_unavailable: 'Вікно Viber недоступне',
  viber_language: 'Інтерфейс Viber має бути англійською',
  my_notes_unavailable: 'Не вдалося відкрити «Мої нотатки»',
  input_not_set: 'Viber не прийняв вставлений текст',
  viber_unsupported_platform: 'Автопост Viber працює лише на Linux',
};

/**
 * @param {'status'|'post'|'avatar'} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{ok:boolean,status:string,reason?:string|null,severity?:string,detail?:string,[key:string]:unknown}>}
 */
export function runViberHelper(action, payload = {}) {
  if (process.platform !== 'linux') {
    return Promise.resolve({ ok: true, status: 'skipped', reason: 'viber_unsupported_platform', severity: 'env' });
  }
  return new Promise((resolve) => {
    const child = execFile('python3', ['-W', 'ignore', HELPER_PATH, action], { timeout: HELPER_TIMEOUT_MS, maxBuffer: 1 << 20, killSignal: 'SIGKILL', env: process.env }, (error, stdout, stderr) => {
      for (const line of String(stderr || '').split('\n')) if (line.trim()) console.log(line.trim());
      const last = String(stdout || '').trim().split('\n').filter(Boolean).pop() || '';
      try {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') { resolve(parsed); return; }
      } catch { /* нижче */ }
      // Помічник убито за таймаутом або він упав без відповіді: що встигло статися, невідомо, тому повтор небезпечний.
      resolve({ ok: false, status: 'failed', reason: error && error.killed ? 'helper_timeout' : 'helper_error', severity: 'after', detail: String(error?.message || last).slice(0, 160) });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Дані завдання черги → вхід помічника. */
export function viberPayloadFromTask(task, overrides = {}) {
  return {
    id: task.jobId,
    url: task.target?.expectedLink || '',
    expectedName: task.target?.expectedName || '',
    message: task.material?.text || '',
    ...overrides,
  };
}
