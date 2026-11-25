// Viber Desktop на Windows (фаза 2, поки лише стан і керування полем вводу): виклики scripts/windows/viber-uia.ps1.
// Viber не віддає через UI Automation назви чатів, тож ЦЕЙ модуль не знає, який чат відкрито. Тому `sendText` вимагає явного
// підтвердження чату від викликача (`confirmedChat: true`) і сам нічого не вирішує про ціль відправки: без окремого запобіжника
// (поки його немає) реальні чати Viber Desktop не обробляє, див. runViberAndroid → viber_desktop_pending.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'windows', 'viber-uia.ps1');
const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

function call(args, timeout = 30_000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
      const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, reason: 'viber_desktop_helper_error', detail: error ? String(error.message).slice(0, 160) : line.slice(0, 160) }); }
    });
  });
}

/** Стан Viber Desktop: запущено, відкриті діалоги, відкрита розмова, довжина тексту в полі. Нічого не змінює. */
export const viberDesktopStatus = () => call(['-Command', 'status']);

/** Закрити діалог кнопкою за назвою (за замовчуванням OK). */
export const viberDesktopDismiss = (button = 'OK') => call(['-Command', 'dismiss', '-Button', button]);

/**
 * Записати текст у поле відкритої розмови й натиснути «Надіслати». Лише з `confirmedChat: true`: підтвердження, що відкрито саме потрібний чат, дає
 * викликач окремим каналом (UIA назв чатів не віддає). Відправляється, тільки якщо в полі після запису рівно цей текст.
 */
export async function viberDesktopSendText(text, { confirmedChat = false } = {}) {
  if (confirmedChat !== true) return { ok: false, reason: 'viber_desktop_chat_unconfirmed' };
  const set = await call(['-Command', 'set-text', '-TextBase64', b64(text)]);
  if (!set.ok) return set;
  const sent = await call(['-Command', 'send', '-ExpectBase64', b64(text)]);
  if (!sent.ok) await call(['-Command', 'clear']);
  return sent;
}
