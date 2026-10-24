// Автопост Telegram через Telegram Web A (web.telegram.org/a) у браузері runner: текст оголошення в чат або в гілку форуму.
// Правила ті самі, що в адаптерів WhatsApp і Viber: до натискання «Надіслати» будь-яка двозначність закінчується без відправки
// (код причини), а після натискання нічого не повторюється. Підтвердження відправки — власне повідомлення в стрічці тієї ж гілки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCdpClient, isLocalCdpWebSocketUrl, normalizeLocalCdpBaseUrl } from './whatsapp-web-cdp.mjs';

const TELEGRAM_WEB = 'https://web.telegram.org/a/';
const WIDE_VIEWPORT = { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false };
const OPEN_CHAT_TIMEOUT_MS = 25_000;
const SEND_CONFIRM_TIMEOUT_MS = 30_000;
// Фото вантажиться довше за текст.
const PHOTO_CONFIRM_TIMEOUT_MS = 90_000;
// Ліміт Telegram на підпис до фото.
const MAX_CAPTION_CHARS = 1024;
// Бюджет проходу «знайти гілки» на один чат, від початку задачі.
const SCAN_BUDGET_MS = 12_000;
const POLL_MS = 400;
const MAX_MESSAGE_CHARS = 4096;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ознаки відмови Telegram. Усе, що не збіглось, лишається «невідомим» і закінчується рішенням власника.
const floodPattern = /(?:flood[_ ]?wait|too many (?:requests|attempts)|забагато (?:запитів|спроб)|слишком много (?:запросов|попыток)|try again (?:in|later)|спробуйте (?:ще раз )?(?:через|пізніше)|повторите (?:попытку )?(?:через|позже))/iu;
const slowModePattern = /(?:slow ?mode|повільн\p{L}* режим|медленн\p{L}* режим)/iu;
const readOnlyPattern = /(?:only admins can (?:post|send|write)|you can['’]?t (?:post|send|write)|you are not allowed to (?:post|send|write)|тільки адміністратори можуть|лише адміністратори можуть|ви не можете (?:писати|надсилати|публікувати)|только администраторы могут|вы не можете (?:писать|отправлять)|writing (?:in this chat )?is (?:restricted|disabled)|надсилати повідомлення (?:тут )?заборонено)/iu;
const bannedPattern = /(?:you (?:were|have been) (?:banned|removed|kicked)|you are banned|вас (?:було )?(?:заблоковано|видалено|вилучено|забанено)|вы (?:были )?(?:заблокированы|удалены|исключены)|you can['’]?t (?:view|access) this (?:chat|group))/iu;
const missingPattern = /(?:no user has the username|username (?:is )?(?:invalid|not occupied)|(?:chat|group|channel) (?:does not exist|doesn['’]?t exist|not found|is unavailable)|не знайдено|не існує|не найден|не существует|invite link (?:is |has )?(?:invalid|expired|been revoked)|посилання[^.]*(?:недійсне|прострочене|скасовано)|ссылка[^.]*(?:недействительна|просрочена|отозвана))/iu;
// «This channel is private»: акаунт не бачить чат (не учасник, вийшов чи вилучений) — не те саме, що «чату не існує».
const privatePattern = /(?:(?:chat|group|channel) is private|(?:чат|група|канал) (?:є )?приватн|(?:чат|группа|канал) (?:является )?приватн)/iu;
const authPattern = /(?:log in to telegram|sign in to telegram|увійти в telegram|войти в telegram|scan from mobile|відскануйте|your phone number)/iu;

/** Як відкрити чат за посиланням Work OS: username, запрошення чи приватний канал (t.me/c/…). */
export function telegramOpenTarget(link) {
  const raw = String(link || '').trim();
  let match = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/(?:\+|joinchat\/)([A-Za-z0-9_-]{10,40})/iu);
  if (match) return { kind: 'invite', hash: match[1] };
  match = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/c\/(\d{5,15})(?:\/(\d{1,12}))?/iu);
  if (match) return { kind: 'private', peerId: `-100${match[1]}`, topicHint: match[2] || null };
  match = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.(?:me|dog)\/([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#]|$)/iu);
  if (match && !/^(?:joinchat|addstickers|share|proxy|socks|login|setlanguage)$/iu.test(match[1])) return { kind: 'username', name: match[1] };
  // Прямий номер чата в адресі Telegram Web (так відкривається «Збережене» і так перевіряється адаптер без чужих чатів).
  match = raw.match(/^https:\/\/web\.telegram\.org\/a\/#(-?\d{5,20})$/iu);
  if (match) return { kind: 'private', peerId: match[1], topicHint: null };
  match = raw.match(/^tg:\/\/resolve\?domain=([A-Za-z][A-Za-z0-9_]{3,31})/iu);
  if (match) return { kind: 'username', name: match[1] };
  return null;
}

/** Адреса Telegram Web для відкриття цілі; `thread` — гілка форуму, яку відкриваємо в уже відомому чаті. */
export function telegramWebUrl(target, thread = null) {
  if (!target) return null;
  // `#@name` Telegram Web A відкидає під час запуску (перевірено наживо 2026-10-24); діє лише глибоке посилання tgaddr.
  if (target.kind === 'username') return `${TELEGRAM_WEB}#?tgaddr=${encodeURIComponent(`tg://resolve?domain=${target.name}`)}`;
  if (target.kind === 'invite') return `${TELEGRAM_WEB}#?tgaddr=${encodeURIComponent(`tg://join?invite=${target.hash}`)}`;
  return `${TELEGRAM_WEB}#${target.peerId}${thread ? `_${thread}` : ''}`;
}

/** Назви збігаються з точністю до регістру, емодзі й розділових знаків: цього досить, щоб це був той самий чат. */
export function similarTelegramTitle(expected, observed) {
  const loose = (value) => String(value || '').normalize('NFC').replace(/[‎‏‪-‮]/gu, '').toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = loose(expected);
  const b = loose(observed);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Секунди очікування з тексту FloodWait («Too many requests. Try again in 1 hour 2 minutes», «FLOOD_WAIT_300»). */
export function parseTelegramFloodSeconds(text) {
  const raw = String(text || '');
  const code = raw.match(/FLOOD_WAIT_(\d{1,7})/iu);
  if (code) return Number(code[1]);
  let seconds = 0;
  for (const [pattern, factor] of [[/(\d+)\s*(?:h(?:ours?)?|год(?:ин\p{L}*)?|ч(?:ас\p{L}*)?)/iu, 3600], [/(\d+)\s*(?:m(?:in(?:utes?)?)?|хв(?:илин\p{L}*)?|мин(?:ут\p{L}*)?)/iu, 60], [/(\d+)\s*(?:s(?:ec(?:onds?)?)?|с(?:ек\p{L}*)?)/iu, 1]]) {
    const found = raw.match(pattern);
    if (found) seconds += Number(found[1]) * factor;
  }
  return seconds;
}

// Порівняння без пробілів і переносів: у повідомленні Telegram переноси, нерозривні пробіли й емодзі-картинки відображаються інакше, ніж у полі.
function squash(value) { return String(value || '').normalize('NFC').replace(/[\s\u00a0\u200b\u200e\u200f]+/gu, ''); }

function normalizeText(value) {
  return String(value || '').normalize('NFC').replace(/ /gu, ' ').replace(/[​‎‏]/gu, '').replace(/[ \t]+/gu, ' ').replace(/\s*\n\s*/gu, '\n').trim();
}

async function findTelegramPage(base, { create = true } = {}) {
  let pages;
  try {
    const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(4_000) });
    pages = await response.json();
  } catch { return { kind: 'blocked', reason: 'cdp_unavailable' }; }
  const page = (Array.isArray(pages) ? pages : []).find((item) => item?.type === 'page' && String(item.url || '').startsWith(TELEGRAM_WEB.slice(0, -1)) && item.webSocketDebuggerUrl);
  if (page) return isLocalCdpWebSocketUrl(page.webSocketDebuggerUrl) ? { kind: 'result', page } : { kind: 'blocked', reason: 'cdp_websocket_not_local' };
  if (!create) return { kind: 'blocked', reason: 'telegram_tab_missing' };
  try {
    const created = await fetch(`${base}/json/new?${encodeURIComponent(TELEGRAM_WEB)}`, { method: 'PUT', signal: AbortSignal.timeout(6_000) });
    const next = await created.json();
    if (next?.webSocketDebuggerUrl && isLocalCdpWebSocketUrl(next.webSocketDebuggerUrl)) return { kind: 'result', page: next };
  } catch { /* вкладку створити не вдалося */ }
  return { kind: 'blocked', reason: 'telegram_page_not_ready' };
}

class TelegramPage {
  constructor(client) {
    // Команда, що ще чекає відповіді, коли з'єднання закривається, відхиляється у `close()`; без обробника це «unhandled rejection»,
    // яка вбила б runner. Кожній команді додаємо порожній обробник (той, хто її чекає, і далі отримує помилку).
    const rawSend = client.send.bind(client);
    client.send = (method, params) => { const promise = rawSend(method, params); promise.catch(() => {}); return promise; };
    this.client = client;
  }
  async evaluate(expression) {
    const response = await this.client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response?.exceptionDetails) throw new Error('telegram_page_script_failed');
    return response?.result?.value;
  }
  async key(key, code, keyCode, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp']) await this.client.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  }
  // Справжні події миші: Telegram Web ігнорує синтетичні click() на частині елементів.
  async click(selectorExpression) {
    const box = await this.evaluate(`(()=>{const el=${selectorExpression};if(!el)return null;el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (!box) return false;
    await this.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) await this.client.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return true;
  }
  close() { try { this.client.close(); } catch { /* вже закрито */ } }
}

const READ_IDENTITY_JS = `(() => {
  try { const raw = localStorage.getItem('user_auth'); if (raw) { const value = JSON.parse(raw); if (value && value.id) return String(value.id); } } catch {}
  try { const g = window.getGlobal && window.getGlobal(); if (g && g.currentUserId) return String(g.currentUserId); } catch {}
  return '';
})()`;

// Що зараз на екрані: чи залогінений, відкритий чат (заголовок, id), поле повідомлення, сповіщення й діалоги.
export const READ_STATE_JS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const middle = document.querySelector('#MiddleColumn');
  const header = middle && middle.querySelector('.MiddleHeader');
  const composer = document.querySelector('#editable-message-text');
  const notices = [...document.querySelectorAll('.Notification, .Notification-container, .modal-dialog, .Modal .modal-content')].filter(visible).map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 600);
  const footer = middle ? [...middle.querySelectorAll('.Composer, .messaging-disabled, .middle-column-footer, .MiddleColumn .footer')].filter(visible).map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 300) : '';
  const peer = header && header.querySelector('[data-peer-id]');
  return {
    url: location.href,
    auth: Boolean(document.querySelector('#auth-qr-form, #auth-phone-number-form, .auth-form')),
    ready: Boolean(document.getElementById('telegram-search-input')),
    title: header ? ((header.querySelector('.fullName, h3, .title') || {}).innerText || '').trim().slice(0, 200) : '',
    status: header ? ((header.querySelector('.status, .group-status') || {}).innerText || '').trim().slice(0, 120) : '',
    peerId: (peer && peer.getAttribute('data-peer-id')) || (location.hash.match(/^#(-?\\d+)/) || [])[1] || '',
    // Ознаки форуму, окрім списку гілок: панель форуму зліва й гілка в адресі. Якщо вони є, а список гілок не прочитався, у чат не пишемо.
    // Живий розбір форуму 2026-10-24: у режимі «як повідомлення» стрічка містить .topic-group з пігулкою .topic-pill (назва гілки), а
    // знизу замість поля стоїть «You can reply to messages in topics»; у режимі гілок зліва .Topic.
    forumUi: Boolean(document.querySelector('#MiddleColumn .topic-pill, #MiddleColumn .topic-group, #LeftColumn .ForumPanel, #LeftColumn .Topic'))
      || /reply to messages in topics|відповідати на повідомлення в темах|відповісти на повідомлення в темах|отвечать на сообщения в темах/i.test(footer)
      || /^#-?\\d+_\\d+/.test(location.hash),
    composer: Boolean(composer && visible(composer)),
    footer, notices,
  };
})()`;

// Гілки форуму. Telegram Web A показує список гілок у лівій колонці, поки відкритий форум (рядки `.Topic`). Закрита гілка має
// значок замка. Структуру перевіряє живий запуск; якщо вона інша, список порожній і чат іде в «Вибрати гілку» з поясненням.
export const READ_TOPICS_JS = `(() => {
  const nodes = [...document.querySelectorAll('#LeftColumn .Topic, #LeftColumn .ForumPanel .ListItem, #LeftColumn [class*="Topic"].ListItem')];
  const seen = new Set();
  const topics = [];
  for (const node of nodes) {
    const link = node.querySelector('a[href*="_"], [data-topic-id]');
    const idAttr = node.getAttribute('data-topic-id') || (link && link.getAttribute('data-topic-id')) || '';
    const hrefId = link && (link.getAttribute('href') || '').match(/_(\\d+)(?:\\D|$)/);
    const id = String(idAttr || (hrefId && hrefId[1]) || '').trim();
    const title = ((node.querySelector('.title, .fullName, h3, .info .title') || node).innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean)[0] || '';
    if (!/^\\d{1,18}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const closed = Boolean(node.querySelector('.icon-lock, [class*="icon-lock"], .closed, [class*="closed"]')) || node.classList.contains('closed');
    topics.push({ id, title: title.slice(0, 120), closed });
  }
  return topics;
})()`;

export const READ_MESSAGES_JS = `(() => [...document.querySelectorAll('#MiddleColumn .Message')].map((node) => {
  const id = node.getAttribute('data-message-id') || '';
  const content = node.querySelector('.text-content');
  const clone = content ? content.cloneNode(true) : null;
  if (clone) {
    clone.querySelectorAll('img[alt]').forEach((img) => { const alt = img.getAttribute('alt'); if (alt) img.replaceWith(document.createTextNode(alt)); });
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\\n')));
  }
  const own = node.classList.contains('own') || Boolean(node.closest('.own'));
  const pending = Boolean(node.querySelector('.icon-message-pending, [class*="message-pending"]'));
  const failed = Boolean(node.querySelector('.icon-message-failed, [class*="message-failed"]'));
  const hasMedia = Boolean(node.querySelector('.media-inner, .Photo, .full-media, .thumbnail, video'));
  return { id, own, pending, failed, hasMedia, text: clone ? String(clone.innerText || clone.textContent || '').slice(0, 4200) : '' };
}).filter((item) => item.id))()`;

// Telegram Web A читає адресу з посилання лише під час запуску застосунку: зміна одного фрагмента (#…) у відкритій вкладці
// може лишитися непоміченою. Тому до потрібної адреси йдемо через порожню сторінку, щоб застосунок стартував заново.
async function openFresh(client, url) {
  await client.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await client.send('Page.navigate', { url });
  await sleep(1_000);
}

async function waitForOpenChat(page, shouldAbort, deadlineAt, stallMs = 0) {
  let last = null;
  const startedWaiting = Date.now();
  while (Date.now() < deadlineAt) {
    if (shouldAbort()) return { aborted: true, state: last };
    // Під час переходу сторінка на мить без контексту: це не збій, просто чекаємо.
    let state = null;
    try { state = await page.evaluate(READ_STATE_JS); } catch { await sleep(POLL_MS); continue; }
    last = state;
    if (state.auth) return { state };
    // Застосунок обробив посилання, але чат не відкрив (адреса порожня): далі чекати марно, нехай викликач почне заново.
    if (stallMs && Date.now() - startedWaiting > stallMs && !/tgaddr|#-?\d/.test(state.url || '') && !state.notices) return { state, stalled: true };
    if (state.notices && (missingPattern.test(state.notices) || privatePattern.test(state.notices))) return { state };
    // Поки застосунок не обробив глибоке посилання (tgaddr), в адресі воно ще стоїть, а на екрані може бути чат із попереднього сеансу.
    if (/tgaddr/.test(state.url || '')) { await sleep(POLL_MS); continue; }
    if (state.title && (state.composer || state.footer || state.notices)) return { state };
    await sleep(POLL_MS);
  }
  return { state: last, timedOut: true };
}

function composerText(page, selector = '#editable-message-text') {
  return page.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('img[alt]').forEach((img) => { const alt = img.getAttribute('alt'); if (alt) img.replaceWith(document.createTextNode(alt)); });
    const blocks = [...clone.children].filter((child) => child.tagName === 'P' || child.tagName === 'DIV');
    if (!blocks.length) return String(clone.innerText || clone.textContent || '');
    return blocks.map((block) => String(block.textContent || '')).join('\\n'); })()`);
}

/** Id користувача, залогіненого в Telegram Web runner: за ним Work OS перевіряє, що це потрібний акаунт. */
export async function readTelegramIdentityViaCdp({ cdpBaseUrl } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  // Лише дивимось на вже відкриту вкладку: вкладку для статусу не створюємо.
  const found = await findTelegramPage(base, { create: false });
  if (found.kind !== 'result') return found;
  const client = await createCdpClient(found.page.webSocketDebuggerUrl);
  const page = new TelegramPage(client);
  try {
    await client.send('Runtime.enable');
    const state = await page.evaluate(READ_STATE_JS);
    if (state.auth) return { kind: 'blocked', reason: 'telegram_not_authenticated' };
    if (!state.ready) return { kind: 'blocked', reason: 'telegram_page_not_ready' };
    const id = String(await page.evaluate(READ_IDENTITY_JS) || '');
    return id ? { kind: 'result', identity: id } : { kind: 'blocked', reason: 'telegram_identity_unknown' };
  } catch { return { kind: 'blocked', reason: 'telegram_page_not_ready' }; }
  finally { page.close(); }
}

/**
 * Публікує текст задачі в чаті Telegram (або в його гілці), чи в режимі `verifyOnly` лише шукає своє повідомлення.
 * Повертає { kind:'result', result } після підтвердженої відправки або { kind:'blocked', reason, ... }; `scan` (форум чи ні й список
 * гілок із позначкою «закрита») повертається в обох випадках, коли чат вдалося відкрити.
 */
export async function sendTelegramAutopostViaCdp(task, { cdpBaseUrl, shouldAbort = () => false, onStep = () => {}, verifyOnly = false, scanOnly = false, anyTitle = false, sinceEpoch = 0 } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  const text = normalizeText(task?.material?.text);
  // Прохід «знайти гілки» тексту не має: він лише дивиться на чат.
  if (!text && !scanOnly) return { kind: 'blocked', reason: 'stale_precondition' };
  const media = task?.material?.media?.base64 ? task.material.media : null;
  if (!verifyOnly && Array.from(text).length > MAX_MESSAGE_CHARS) return { kind: 'blocked', reason: 'telegram_text_too_long' };
  // Підпис до фото в Telegram — до 1024 символів: довший не обрізаємо, а не надсилаємо.
  if (!verifyOnly && media && Array.from(text).length > MAX_CAPTION_CHARS) return { kind: 'blocked', reason: 'telegram_caption_too_long' };
  const target = telegramOpenTarget(task?.target?.expectedLink);
  if (!target) return { kind: 'blocked', reason: 'telegram_chat_missing', detail: 'link_not_recognised' };
  const found = await findTelegramPage(base);
  if (found.kind !== 'result') return found;
  const client = await createCdpClient(found.page.webSocketDebuggerUrl);
  const page = new TelegramPage(client);
  const startedAt = Date.now();
  const deadlineAt = startedAt + 120_000;
  let focusEmulated = false;
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable').catch(() => {});
    // Вкладка у фоні: без емуляції фокусу поле повідомлення не отримує текст. Широкий екран потрібен, щоб лівий список (гілки) був видимий.
    try { await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); focusEmulated = true; } catch { focusEmulated = false; }
    await client.send('Emulation.setDeviceMetricsOverride', WIDE_VIEWPORT);
    if (!focusEmulated) await client.send('Page.bringToFront');

    // 1. Той самий акаунт, що в Work OS.
    const initial = await page.evaluate(READ_STATE_JS);
    if (initial.auth) return { kind: 'blocked', reason: 'telegram_not_authenticated' };
    const identity = String(await page.evaluate(READ_IDENTITY_JS) || '');
    if (!identity) return { kind: 'blocked', reason: 'telegram_identity_unknown' };
    const expectedIdentity = task?.telegram?.webUserId || '';
    if (!expectedIdentity) return { kind: 'blocked', reason: 'telegram_account_unbound', identity };
    if (identity !== expectedIdentity) return { kind: 'blocked', reason: 'telegram_account_mismatch', identity };
    if (shouldAbort()) return { kind: 'blocked', reason: 'cancelled' };

    // 2. Відкрити чат за посиланням і переконатися, що це він.
    onStep('open', 'відкриваю чат');
    const url = telegramWebUrl(target);
    await openFresh(client, url);
    let opened = await waitForOpenChat(page, shouldAbort, Math.min(deadlineAt, Date.now() + OPEN_CHAT_TIMEOUT_MS), 7_000);
    // Telegram Web іноді з'їдає глибоке посилання відразу після завантаження: одна повторна спроба замість 25 с очікування.
    if (opened.stalled) {
      await openFresh(client, url);
      opened = await waitForOpenChat(page, shouldAbort, Math.min(deadlineAt, Date.now() + OPEN_CHAT_TIMEOUT_MS), 0);
    }
    if (opened.aborted) return { kind: 'blocked', reason: 'cancelled' };
    const state = opened.state || {};
    if (state.auth) return { kind: 'blocked', reason: 'telegram_not_authenticated' };
    if (state.notices && missingPattern.test(state.notices)) return { kind: 'blocked', reason: 'telegram_chat_missing', detail: state.notices };
    if (state.notices && privatePattern.test(state.notices)) return { kind: 'blocked', reason: 'telegram_no_access', detail: state.notices };
    if (state.notices && floodPattern.test(state.notices)) return { kind: 'blocked', reason: 'telegram_flood_wait', floodSeconds: parseTelegramFloodSeconds(state.notices) || 300, detail: state.notices };
    if (opened.timedOut || !state.title) return { kind: 'blocked', reason: 'telegram_chat_not_opened', detail: `${state.url || ''} | ${state.notices || ''}` };
    if (!anyTitle && !similarTelegramTitle(task.target.expectedName, state.title)) {
      return { kind: 'blocked', reason: 'target_unconfirmed', observedTarget: state.title, detail: `У Work OS: ${task.target.expectedName}` };
    }
    const observedTarget = state.title;
    const peerId = state.peerId || (target.kind === 'private' ? target.peerId : '');

    // 3. Форум чи ні й гілки (закриті позначені). Форум без вибраної гілки в чат не пишемо: публікація в «Загальну» замість потрібної гілки
    // гірша за пропуск, тож і форум, чий список гілок не прочитався, іде на вибір гілки.
    await sleep(600);
    const rootUrl = peerId ? `${TELEGRAM_WEB}#${peerId}` : url;
    const panelTopics = await page.evaluate(READ_TOPICS_JS);
    const forum = (Array.isArray(panelTopics) && panelTopics.length > 0) || Boolean((await page.evaluate(READ_STATE_JS)).forumUi);
    const chosen = task?.telegram?.thread || null;
    const knownTopics = Array.isArray(task?.telegram?.topics) ? task.telegram.topics : [];
    // Список гілок збираємо, лише коли гілку ще не вибрано (або для діагностики): для вибраної він уже збережений.
    let topics = [];
    if (forum) {
      onStep('topics', 'збираю гілки чату');
      // Список гілок збирає лише окремий прохід (scanOnly) у межах бюджету часу; задача публікації без вибраної гілки його не збирає.
      topics = scanOnly ? await collectTopics(page, client, rootUrl, shouldAbort, Math.min(deadlineAt, startedAt + SCAN_BUDGET_MS), knownTopics) : knownTopics;
    }
    let scan = { forum, topics };
    // sendAttempted: кнопку «Надіслати» вже натиснуто. Лише тоді задача займає вікно інтервалу «N на годину»; збій до натискання його не витрачає.
    let sendAttempted = false;
    const withScan = (extra) => ({ ...extra, observedTarget, scan, sendAttempted });
    if (forum && !scanOnly) {
      if (!chosen) return withScan({ kind: 'blocked', reason: 'thread_required' });
      const known = topics.find((item) => item.id === chosen.id);
      if (known?.closed) return withScan({ kind: 'blocked', reason: 'thread_closed', detail: 'closed' });
      if (!peerId) return withScan({ kind: 'blocked', reason: 'telegram_thread_not_opened', detail: 'peer_id_unknown' });
      onStep('thread', `відкриваю гілку «${chosen.title || chosen.id}»`);
      await openFresh(client, telegramWebUrl({ kind: 'private', peerId }, chosen.id));
      const inTopic = await waitForOpenChat(page, shouldAbort, Math.min(deadlineAt, Date.now() + OPEN_CHAT_TIMEOUT_MS));
      if (inTopic.aborted) return withScan({ kind: 'blocked', reason: 'cancelled' });
      const topicState = inTopic.state || {};
      if (inTopic.timedOut || !(topicState.url || '').includes(`_${chosen.id}`)) return withScan({ kind: 'blocked', reason: 'telegram_thread_not_opened', detail: topicState.url || '' });
      // Гілка відкрилась, а поля повідомлення немає: вона закрита (або лише для адмінів), писати туди не можна.
      if (!verifyOnly && !(await page.evaluate(READ_STATE_JS)).composer) {
        scan = { forum, topics: topics.some((item) => item.id === chosen.id) ? topics.map((item) => (item.id === chosen.id ? { ...item, closed: true } : item)) : [...topics, { id: chosen.id, title: chosen.title || chosen.id, closed: true }] };
        return withScan({ kind: 'blocked', reason: 'thread_closed', detail: 'composer_missing' });
      }
    }

    // Лише зібрати відомості про чат (форум чи ні, гілки), нічого не читаючи далі й не пишучи: для діагностики.
    if (scanOnly) return withScan({ kind: 'blocked', reason: 'scan_only' });
    // `await` обов'язковий: без нього `finally` закрив би з'єднання, поки перевірка ще гортає стрічку.
    if (verifyOnly) return await verifyOwnMessage(page, text, sinceEpoch, withScan, shouldAbort, deadlineAt);

    // 4. Чи можна тут писати.
    const writable = await page.evaluate(READ_STATE_JS);
    const blockedText = `${writable.footer || ''} ${writable.notices || ''}`;
    if (!writable.composer) {
      if (bannedPattern.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_banned', detail: blockedText });
      if (slowModePattern.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_slow_mode', detail: blockedText });
      // Кнопка вступу замість поля: акаунт не в чаті. Це не «пишуть лише адміни», тож чат не архівуємо, а віддаємо власнику.
      if (/^\s*(?:join|приєднатися|присоединиться)/iu.test(writable.footer || '')) return withScan({ kind: 'blocked', reason: 'telegram_no_access', detail: blockedText });
      if (readOnlyPattern.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_read_only', detail: blockedText });
      return withScan({ kind: 'blocked', reason: 'telegram_composer_not_found', detail: blockedText });
    }
    if (shouldAbort()) return withScan({ kind: 'blocked', reason: 'cancelled' });

    // 5. Фото (якщо є): вставка в поле відкриває вікно «Send Photo» з власним полем підпису. Далі текст (рядки через Shift+Enter) і звірка.
    const before = await page.evaluate(READ_MESSAGES_JS);
    const beforeIds = new Set(before.map((item) => item.id));
    let field = '#editable-message-text';
    if (media) {
      onStep('photo', 'додаю фото');
      const pasted = await page.evaluate(`(() => { const node = document.querySelector('#editable-message-text'); if (!node || typeof DataTransfer === 'undefined') return false;
        try { const raw = atob(${JSON.stringify(String(media.base64))}); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
          const file = new File([bytes], ${JSON.stringify(String(media.fileName || 'work-os.jpg'))}, { type: ${JSON.stringify(String(media.contentType || 'image/jpeg'))} });
          const transfer = new DataTransfer(); transfer.items.add(file); node.focus();
          node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); return true; } catch { return false; } })()`);
      let opened = false;
      for (let attempt = 0; pasted && attempt < 40 && !opened; attempt += 1) {
        opened = Boolean(await page.evaluate(`Boolean(document.querySelector('.Modal #editable-message-text-modal'))`));
        if (!opened) await sleep(400);
      }
      if (!opened) { await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'telegram_attachment_not_opened' }); }
      await sleep(600);
      field = '#editable-message-text-modal';
    }
    onStep('text', 'вводжу текст');
    if (!await page.click(`document.querySelector(${JSON.stringify(field)})`)) { if (media) await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'telegram_composer_not_found' }); }
    await page.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(field)}); node.focus(); const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('delete'); return true; })()`);
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (index > 0) await page.key('Enter', 'Enter', 13, 8);
      if (lines[index]) await client.send('Input.insertText', { text: lines[index] });
    }
    await sleep(400);
    if (normalizeText(await composerText(page, field)) !== text) { if (media) await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'telegram_text_mismatch' }); }
    if (Date.now() >= deadlineAt) { if (media) await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'autopost_budget_exhausted' }); }
    // До кнопки відправки ще можна відмовитись, після неї ні.
    if (shouldAbort()) { if (media) await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'cancelled' }); }

    // 6. Надіслати: у вікні фото — головна кнопка вікна, без нього — кнопка поля повідомлення.
    onStep('send', 'надсилаю');
    const clicked = await page.click(media
      ? `[...document.querySelectorAll('.Modal button.primary')].filter((el) => !el.disabled && el.getBoundingClientRect().width > 0).pop() || null`
      : `(() => { const buttons = [...document.querySelectorAll('#MiddleColumn button, #MiddleColumn .Button')];
        return buttons.find((el) => el.classList.contains('send') && !el.disabled) || buttons.find((el) => /^(send message|надіслати повідомлення|отправить сообщение)$/iu.test(el.getAttribute('aria-label') || el.title || '')) || null; })()`);
    sendAttempted = true;
    if (!clicked) {
      await page.key('Enter', 'Enter', 13);
    } else if (media) {
      // Вікно фото закривається, щойно Telegram прийняв відправку. Якщо воно ще відкрите через кілька секунд, клік не подіяв (фото ще
      // обробляється): тиснемо ще раз, до трьох разів. Поки вікно відкрите, нічого не надіслано, тож дубля не буде.
      for (let again = 0; again < 2; again += 1) {
        await sleep(3_000);
        if (!await page.evaluate(`Boolean(document.querySelector('.Modal #editable-message-text-modal'))`)) break;
        await page.click(`[...document.querySelectorAll('.Modal button.primary')].filter((el) => !el.disabled && el.getBoundingClientRect().width > 0).pop() || null`);
      }
    }

    // 7. Підтвердження: своє повідомлення з цим текстом у стрічці цієї гілки, вже не «годинник». З фото чекаємо довше: воно вантажиться.
    onStep('confirm', 'перевіряю, що повідомлення в чаті');
    const wanted = squash(text).slice(0, 40);
    const confirmDeadline = Date.now() + (media ? PHOTO_CONFIRM_TIMEOUT_MS : SEND_CONFIRM_TIMEOUT_MS);
    while (Date.now() < confirmDeadline) {
      await sleep(POLL_MS);
      const messages = await page.evaluate(READ_MESSAGES_JS);
      const mine = messages.find((item) => !beforeIds.has(item.id) && item.own && squash(item.text).startsWith(wanted));
      if (mine) {
        if (mine.failed) return withScan({ kind: 'blocked', reason: media ? 'telegram_attachment_failed' : 'telegram_send_failed' });
        if (!mine.pending) return { kind: 'result', result: { status: 'sent', observedTarget, targetVerified: true, sendConfirmed: true, mediaConfirmed: media ? mine.hasMedia : undefined, sendAttempted: true, scan } };
        continue;
      }
      const notice = (await page.evaluate(READ_STATE_JS)).notices || '';
      if (notice && floodPattern.test(notice)) return withScan({ kind: 'blocked', reason: 'telegram_flood_wait', floodSeconds: parseTelegramFloodSeconds(notice) || 300, detail: notice, afterSend: true });
      if (notice && slowModePattern.test(notice)) return withScan({ kind: 'blocked', reason: 'telegram_slow_mode', detail: notice, afterSend: true });
    }
    // Не вдалось підтвердити: зберігаємо, що саме було на екрані (знімок поруч із журналом runner) і стан поля, кнопки й сповіщень.
    const diagnostic = await page.evaluate(`(() => { const composer = document.querySelector('#editable-message-text');
      return { composerChars: composer ? (composer.innerText || '').length : -1, own: document.querySelectorAll('#MiddleColumn .Message.own').length, messages: document.querySelectorAll('#MiddleColumn .Message').length,
        modalOpen: Boolean(document.querySelector('.Modal #editable-message-text-modal')),
        sendButtons: [...document.querySelectorAll('#MiddleColumn button.send')].map((b) => String(b.className).slice(0, 60) + (b.disabled ? ' disabled' : '')),
        notices: [...document.querySelectorAll('.Notification, .modal-dialog')].map((n) => (n.innerText || '').replace(/\\s+/g, ' ').slice(0, 120)) }; })()`).catch(() => null);
    try {
      const shot = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
      const dir = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'work-os');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'telegram-last-failure.jpg'), Buffer.from(shot.data, 'base64'));
    } catch { /* знімок необов'язковий */ }
    // Вікно фото ще відкрите: повідомлення не відправлялось, тож закриваємо його (без чернетки в чаті) і повертаємо задачу в чергу.
    if (media && diagnostic?.modalOpen) {
      await discardAttachment(page);
      sendAttempted = false;
      return withScan({ kind: 'blocked', reason: 'telegram_send_not_clicked', detail: JSON.stringify({ clicked, ...diagnostic }) });
    }
    return withScan({ kind: 'blocked', reason: 'send_not_confirmed', detail: JSON.stringify({ clicked, ...diagnostic }) });
  } catch (error) {
    return { kind: 'blocked', reason: 'telegram_page_not_ready', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    try { await client.send('Emulation.clearDeviceMetricsOverride'); } catch { /* вкладка вже закрита */ }
    page.close();
  }
}

// Закрити вікно вкладення без відправки (кнопка «Discard attachments» або Escape): фото не мусить лишитись у полі до наступної задачі.
async function discardAttachment(page) {
  try {
    const clicked = await page.click(`[...document.querySelectorAll('.Modal button')].find((el) => /discard attachments|скасувати вкладення|відхилити вкладення|отменить вложения/iu.test(el.getAttribute('aria-label') || el.title || ''))`);
    if (!clicked) await page.key('Escape', 'Escape', 27);
    await sleep(500);
    if (await page.evaluate(`Boolean(document.querySelector('.Modal #editable-message-text-modal'))`)) await page.key('Escape', 'Escape', 27);
  } catch { /* вкладка вже закрита */ }
}

// Список гілок форуму. У режимі гілок їх дає ліва панель (`.Topic`); у режимі «як повідомлення» у стрічці видно лише пігулки гілок з
// недавніми повідомленнями (`.topic-pill`), тож id гілки беремо з адреси після відкриття кожної, а «закрита» — це гілка без поля
// повідомлення (закрита чи лише для адмінів: писати туди однаково не можна). Повний список гілок без недавніх повідомлень так не побачити.
async function collectTopics(page, client, rootUrl, shouldAbort, budgetUntil, known = []) {
  const panel = await page.evaluate(READ_TOPICS_JS);
  if (Array.isArray(panel) && panel.length) return panel;
  const titles = await page.evaluate(`[...new Set([...document.querySelectorAll('#MiddleColumn .topic-pill-title')].map((node) => (node.innerText || '').trim()).filter(Boolean))].slice(0, 10)`);
  const knownByTitle = new Map(known.map((item) => [item.title, item]));
  const topics = [];
  if (process.env.TG_DEBUG) console.error('topics: pills', JSON.stringify(titles), 'budget left', budgetUntil - Date.now());
  for (const title of Array.isArray(titles) ? titles : []) {
    if (shouldAbort() || Date.now() > budgetUntil) break;
    // Гілку, яку вже збирали, повторно не відкриваємо: це найдорожчий крок (≈3 с на гілку).
    const seen = knownByTitle.get(title.slice(0, 120));
    if (seen) { topics.push(seen); continue; }
    // Пігулка бува поза екраном або під липкою шапкою: до трьох спроб (справжній клік, потім програмний), щоразу заново знаходимо її.
    const find = `[...document.querySelectorAll('#MiddleColumn .topic-pill')].find((node) => ((node.querySelector('.topic-pill-title') || node).innerText || '').trim() === ${JSON.stringify(title)})`;
    let id = '';
    for (let attempt = 0; attempt < 3 && !id && Date.now() < budgetUntil; attempt += 1) {
      const clicked = attempt < 2 ? await page.click(find) : Boolean(await page.evaluate(`(() => { const el = ${find}; if (!el) return false; el.click(); return true; })()`));
      if (process.env.TG_DEBUG) console.error('topics: click', title, attempt, clicked, 'left', budgetUntil - Date.now());
      if (!clicked) { await sleep(300); continue; }
      for (let poll = 0; poll < 10 && !id; poll += 1) {
        await sleep(250);
        id = String((await page.evaluate('location.hash')).match(/_(\d{1,18})/u)?.[1] || '');
      }
      if (Date.now() > budgetUntil) break;
    }
    if (id && !topics.some((item) => item.id === id)) {
      // Поле повідомлення зʼявляється не одразу: чекаємо до 2,5 с, інакше гілка помилково вважалась би закритою.
      let state = await page.evaluate(READ_STATE_JS);
      for (let attempt = 0; attempt < 10 && !state.composer && !state.footer; attempt += 1) { await sleep(250); state = await page.evaluate(READ_STATE_JS); }
      topics.push({ id, title: title.slice(0, 120), closed: !state.composer });
    }
    // Назад у стрічку без перезавантаження застосунку (повний openFresh коштував ≈6 с на гілку).
    await page.evaluate('history.back()');
    let back = false;
    for (let attempt = 0; attempt < 16 && !back; attempt += 1) {
      await sleep(250);
      back = Boolean(await page.evaluate(`!/_\\d/.test(location.hash) && document.querySelectorAll('#MiddleColumn .topic-pill').length > 0`));
    }
    if (!back) await openFresh(client, rootUrl);
  }
  return topics;
}

// «Перевірити»: нічого не надсилаємо, лише шукаємо своє повідомлення з цим текстом, гортаючи стрічку вгору.
async function verifyOwnMessage(page, text, _sinceEpoch, withScan, shouldAbort, deadlineAt) {
  const wanted = squash(text).slice(0, 40);
  const hit = (messages) => messages.find((item) => item.own && squash(item.text).startsWith(wanted));
  // Стрічка підвантажується не миттєво: чекаємо до 10 с, поки зʼявляться повідомлення (інакше порожній список виглядає як «початок чату»).
  for (let attempt = 0; attempt < 25 && !(await page.evaluate(READ_MESSAGES_JS)).length; attempt += 1) await sleep(400);
  await sleep(600);
  for (let pageNumber = 0; pageNumber < 16 && Date.now() < deadlineAt; pageNumber += 1) {
    if (shouldAbort()) return withScan({ kind: 'blocked', reason: 'cancelled' });
    const found = hit(await page.evaluate(READ_MESSAGES_JS));
    if (found) {
      const known = withScan({});
      return { kind: 'result', result: { status: 'sent', observedTarget: known.observedTarget, targetVerified: true, sendConfirmed: true, scan: known.scan } };
    }
    const moved = await page.evaluate(`(() => { let el = document.querySelector('#MiddleColumn .MessageList'); if (!el) return { ok: false };
      const before = el.scrollTop; el.scrollTop = 0; return { ok: true, atTop: before <= 2 }; })()`);
    await sleep(900);
    if (!moved?.ok || moved.atTop) break;
  }
  return withScan({ kind: 'blocked', reason: 'message_not_found' });
}
