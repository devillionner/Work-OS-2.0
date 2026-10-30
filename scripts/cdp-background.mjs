// Автопост не заважає власнику (2026-10-30): вкладки runner живуть у фоні, без фокусу, без звуку і без підняття вікон.
//  * `Page.bringToFront` не викликається ніде: без емуляції фокусу це збій середовища з поясненням, а не підняття вкладки;
//  * нова вкладка створюється через `Target.createTarget {background:true}`, а не через `/json/new` (той робить її активною);
//  * звук вимикається на самій сторінці: у CDP немає команди «вимкнути вкладку», тож перед скриптами сторінки ставиться заглушка
//    для `HTMLMediaElement.play`, `Audio` і `AudioContext` (сповіщення WhatsApp і Telegram Web не звучать, відео в інших вкладках не зачеплено);
//  * Opera, запущена без прапорців проти гальмування прихованих вікон, обмежує таймери вкладки: це видно з командного рядка браузера.
import { readdirSync, readFileSync } from 'node:fs';
import { createCdpClient } from './whatsapp-web-cdp.mjs';

export const THROTTLE_FLAGS = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];

export class BackgroundModeError extends Error {
  constructor(message) { super(message); this.name = 'BackgroundModeError'; this.code = 'focus_emulation_unavailable'; }
}

/** Заглушка звуку: сповіщення (`new Audio().play()`, `<audio>`, Web Audio) німі, решта сторінки працює як раніше. */
export const MUTE_SCRIPT = `(() => {
  if (window.__workOsMuted) return;
  window.__workOsMuted = true;
  try {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.apply(this, arguments); };
    const ctx = window.AudioContext || window.webkitAudioContext;
    if (ctx) {
      ctx.prototype.resume = function () { try { this.suspend(); } catch (e) {} return Promise.resolve(); };
    }
  } catch (e) {}
})();`;

const entered = new WeakSet();

/**
 * Режим «у фоні»: вкладка вважає, що вона у фокусі (емуляція), і німа. Викликається один раз на клієнт. Без емуляції фокусу — помилка з кодом
 * `focus_emulation_unavailable`: runner ставить чергу на паузу з поясненням і нічого не піднімає.
 */
export async function enterBackgroundMode(client) {
  if (entered.has(client)) return;
  try { await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
  catch { throw new BackgroundModeError('Браузер не дозволив режим без фокусу.'); }
  entered.add(client);
  try {
    await client.send('Page.enable').catch(() => {});
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: MUTE_SCRIPT });
    await client.send('Runtime.evaluate', { expression: MUTE_SCRIPT });
  } catch { /* звук — запобіжник, а не умова роботи */ }
}

/** Нова вкладка у фоні: активна вкладка власника не змінюється. Повертає запис зі списку `/json/list` (з `webSocketDebuggerUrl`). */
export async function openBackgroundTab(base, url) {
  const version = await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(4_000) })).json();
  const wsUrl = String(version?.webSocketDebuggerUrl || '');
  if (!/^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(wsUrl)) throw new Error('CDP browser websocket is not local.');
  const browser = await createCdpClient(wsUrl);
  let targetId = '';
  try {
    const created = await browser.send('Target.createTarget', { url, background: true });
    targetId = String(created?.targetId || '');
  } finally { browser.close(); }
  if (!targetId) throw new Error('CDP did not create a background tab.');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pages = await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(4_000) })).json();
    const page = (Array.isArray(pages) ? pages : []).find((item) => item?.id === targetId && item.webSocketDebuggerUrl);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('CDP background tab did not appear.');
}

/**
 * Прапорці браузера на порту налагодження, яких бракує для роботи в фоні. `null` — браузер не знайдено чи командний рядок не прочитався
 * (тоді нічого не повідомляємо). Читає лише /proc, жодних запитів.
 */
export function missingThrottleFlags(port = 9222) {
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      let args;
      // Opera переписує argv в один рядок через пробіли, тож ділимо й за пробілами.
      try { args = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split(/[\0\s]+/).filter(Boolean); } catch { continue; }
      if (!args.some((arg) => arg === `--remote-debugging-port=${port}`) || args.some((arg) => arg.startsWith('--type='))) continue;
      return THROTTLE_FLAGS.filter((flag) => !args.includes(flag));
    }
  } catch { return null; }
  return null;
}
