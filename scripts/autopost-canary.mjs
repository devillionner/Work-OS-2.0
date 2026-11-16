// Пробна відправка (canary) і відбиток середовища для трьох платформ (3.18.0). Той самий адаптер і ті самі кроки, що для чату, але
// в безпечне місце, нікому не видиме: Viber → «My Notes», WhatsApp → чат «Ви», Telegram → «Збережене» (Saved Messages).
// Для Viber окремо перевіряється відкриття за запрошенням: будь-яке запрошення з черги (лише відкрити, нічого не надсилати).
import { readFileSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { CANARY_IMAGE } from './autopost-canary-image.mjs';
import { saveFailureSnapshot } from './failure-snapshots.mjs';
import { runViberAndroid, viberFingerprint } from './viber-android.mjs';
import { readTelegramIdentityViaCdp, sendTelegramAutopostViaCdp } from './telegram-autopost-cdp.mjs';
import { readWhatsappHomeHealthViaCdp, sendWhatsappAutopostViaCdp } from './whatsapp-web-cdp.mjs';

const stamp = () => new Date().toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
const canaryText = (name) => `Work OS: пробна відправка ${name} ${stamp()} (можна видалити)`;

function osInfo() {
  let id = '';
  try { id = readFileSync('/etc/os-release', 'utf8').split('\n').filter((line) => /^(ID|VERSION_ID)=/.test(line)).map((line) => line.split('=')[1].replace(/"/g, '')).join(' '); } catch { /* без файла */ }
  return { os: id.trim(), kernel: osRelease().split('-')[0], session: process.env.XDG_SESSION_TYPE || '', desktop: process.env.XDG_CURRENT_DESKTOP || '' };
}

async function browserInfo(cdp) {
  const out = { browser: '', mode: '' };
  try {
    const version = await (await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
    out.browser = String(version.Browser || '').slice(0, 40);
    out.mode = /Headless/.test(String(version['User-Agent'] || '')) ? 'headless-ua' : '';
  } catch { out.browser = 'не відповідає'; }
  return out;
}

async function telegramVariant(cdp) {
  try {
    const list = await (await fetch(`${cdp}/json`, { signal: AbortSignal.timeout(3000) })).json();
    const tab = list.find((item) => item.type === 'page' && /web\.telegram\.org/.test(item.url));
    return tab ? (/\/k\//.test(tab.url) ? 'Web K' : 'Web A') : 'немає вкладки';
  } catch { return ''; }
}

/** Відбиток середовища платформи (null — зараз зібрати не можна, напр. Viber у розпалі задачі). */
export async function collectFingerprint(platform, { cdp = '' } = {}) {
  const base = osInfo();
  if (platform === 'viber') {
    const viber = await viberFingerprint().catch(() => ({ android: 'недоступний' }));
    return viber ? { ...base, ...viber } : null;
  }
  const browser = cdp ? await browserInfo(cdp) : { browser: 'не підключений', mode: '' };
  return { ...base, ...browser, ...(platform === 'telegram' ? { telegram: cdp ? await telegramVariant(cdp) : '' } : {}) };
}

/** Знімок вкладки браузера для невідомого стану (скріншот і текст сторінки). */
export async function snapshotBrowserTab(cdp, urlPart, platform, code, detail = '') {
  try {
    const list = await (await fetch(`${cdp}/json`, { signal: AbortSignal.timeout(3000) })).json();
    const tab = list.find((item) => item.type === 'page' && item.url.includes(urlPart));
    if (!tab) return saveFailureSnapshot({ platform, code, detail: `${detail} | вкладки немає` });
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; setTimeout(reject, 4000); });
    const ask = (id, method, params = {}) => new Promise((resolve) => {
      const handler = (event) => { const message = JSON.parse(event.data); if (message.id === id) { ws.removeEventListener('message', handler); resolve(message.result); } };
      ws.addEventListener('message', handler); ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => resolve(null), 8000);
    });
    const shot = await ask(1, 'Page.captureScreenshot', { format: 'png' });
    const text = await ask(2, 'Runtime.evaluate', { expression: '(document.body && document.body.innerText || "").slice(0, 20000) + "\\n---\\n" + location.href', returnByValue: true });
    ws.close();
    return saveFailureSnapshot({ platform, code, png: shot?.data ? Buffer.from(shot.data, 'base64') : null, tree: text?.result?.value || '', detail });
  } catch { return saveFailureSnapshot({ platform, code, detail: `${detail} | знімок вкладки не вдався` }); }
}

const CHAT_LEVEL_REASONS = new Set(['viber_chat_missing', 'viber_banned', 'viber_read_only', 'viber_not_joined', 'target_unconfirmed', 'target_name_missing', 'invalid_viber_link']);
const failed = (code, detail = '') => ({ ok: false, code, detail: String(detail).slice(0, 300) });

async function canaryViber({ inviteLink, inviteName, shouldAbort, onStep }) {
  // 1) Відкриття за запрошенням (лише відкрити й закрити, нікуди не вступаємо й нічого не шлемо).
  if (inviteLink) {
    onStep?.('canary', 'перевіряю відкриття запрошення');
    const open = await runViberAndroid('post', { id: 'canary-open', url: inviteLink, expectedName: inviteName || 'чат', openOnly: true }, { shouldAbort });
    // Будь-який впізнаний екран (розмова, сторінка вступу, відмова: неактивне посилання, бан) означає, що відкриття працює; проблема
    // лише в самому чаті, а не в середовищі. Не впізнано (список чатів, невідомий діалог) — збій середовища.
    if (open.status !== 'checked' && !CHAT_LEVEL_REASONS.has(String(open.reason))) return failed(open.reason || 'viber_failed', open.detail);
  }
  // 2) Повний шлях відправки в «My Notes»: фото, підпис, «Надіслати», підтвердження.
  onStep?.('canary', 'пробна відправка в My Notes');
  const result = await runViberAndroid('post', { id: 'canary', testTarget: 'my_notes', expectedName: 'My Notes', message: canaryText('Viber'), media: CANARY_IMAGE }, { shouldAbort, onStep });
  return result.status === 'sent' ? { ok: true } : failed(result.reason || 'viber_failed', result.detail);
}

async function canaryTelegram({ cdp, shouldAbort, onStep }) {
  const identity = await readTelegramIdentityViaCdp({ cdpBaseUrl: cdp });
  if (identity.kind !== 'result') return failed(identity.reason || 'telegram_page_not_ready');
  onStep?.('canary', 'пробна відправка у «Збережене»');
  const task = {
    kind: 'telegram_autopost', canary: true,
    target: { expectedName: 'Saved Messages', expectedLink: `https://web.telegram.org/a/#${identity.identity}` },
    telegram: { webUserId: identity.identity },
    material: { text: canaryText('Telegram'), media: { ...CANARY_IMAGE } },
  };
  const result = await sendTelegramAutopostViaCdp(task, { cdpBaseUrl: cdp, shouldAbort, onStep, anyTitle: true });
  return result.kind === 'result' && result.result?.status === 'sent' ? { ok: true } : failed(result.reason || 'telegram_failed', result.detail);
}

async function canaryWhatsapp({ cdp, shouldAbort, onStep }) {
  const home = await readWhatsappHomeHealthViaCdp({ cdpBaseUrl: cdp });
  if (home.kind !== 'result') return failed(home.reason || 'cdp_unavailable');
  if (!home.authenticated) return failed('page_not_ready', 'WhatsApp Web просить увійти');
  onStep?.('canary', 'пробна відправка в чат «Ви»');
  const task = { kind: 'whatsapp_autopost', canary: true, target: { expectedName: 'Ви', selfChat: true }, material: { text: canaryText('WhatsApp'), media: { ...CANARY_IMAGE } } };
  const result = await sendWhatsappAutopostViaCdp(task, { cdpBaseUrl: cdp, shouldAbort, onStep });
  return result.kind === 'result' && result.result?.status === 'sent' ? { ok: true } : failed(result.reason || 'whatsapp_failed', result.detail);
}

/**
 * Пробна відправка платформи. Помилка до відправки (середовище) — { ok:false, code, detail }; знімок невідомого стану зберігається тут.
 * @param {'viber'|'telegram'|'whatsapp'} platform
 */
export async function runCanary(platform, options = {}) {
  const started = Date.now();
  let result;
  try {
    result = platform === 'viber' ? await canaryViber(options) : platform === 'telegram' ? await canaryTelegram(options) : await canaryWhatsapp(options);
  } catch (error) {
    result = failed(error?.code || 'canary_error', error instanceof Error ? error.message : String(error));
  }
  if (!result.ok && platform !== 'viber' && options.cdp) {
    await snapshotBrowserTab(options.cdp, platform === 'telegram' ? 'web.telegram.org' : 'web.whatsapp.com', platform, `canary-${result.code}`, result.detail);
  }
  return { ...result, ms: Date.now() - started };
}
