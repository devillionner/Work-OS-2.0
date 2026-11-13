// Автопост Telegram через Telegram Web A (web.telegram.org/a) у браузері runner: текст оголошення в чат або в гілку форуму.
// Правила ті самі, що в адаптерів WhatsApp і Viber: до натискання «Надіслати» будь-яка двозначність закінчується без відправки
// (код причини), а після натискання нічого не повторюється. Підтвердження відправки — власне повідомлення в стрічці тієї ж гілки.
import { enterBackgroundMode, openBackgroundTab } from './cdp-background.mjs';
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
// Підвал закритої гілки (живий текст 2026-10-25: «The topic is closed»). Це друга ознака після значка замка в списку гілок.
const topicClosedPattern = /(?:topic is closed|тему закрито|тема закрита|тема закрыта|тема закрита адміністратор|закрыта админ)/iu;
// Підвал чату, де поля немає з інших причин (нічний режим бота, повільний режим, права чату): не закрита гілка і не привід для архіву.
const forumHintPattern = /(?:reply to messages in topics|відповідати на повідомлення в темах|відповісти на повідомлення в темах|отвечать на сообщения в темах)/iu;
// Платні повідомлення (Telegram Stars): чат бере зірки за кожне вхідне повідомлення. Діалог «Confirm Payment … charges 385 Stars per incoming message»
// з кнопками «Cancel» і «Pay for 1 message» адаптер не торкається ніколи: бачить його — закриває «Cancel» (чи Escape) і віддає `telegram_paid_messages`.
// Це текст діалогу, не підпису до фото: у вікні відправки фото (є поле підпису) текст оголошення сюди не потрапляє.
export const paidDialogPattern = /(?:confirm(?:ation of)? payment|pay for\s+\d*\s*messages?|charges?\s+[\d\s.,]*(?:stars?|★|⭐)|[\d.,]+\s*stars?\s+per\s+(?:incoming\s+)?message|(?:підтверд\p{L}*|підтвердіть)\s+(?:оплат|платіж)\p{L}*|(?:сплатити|оплатити|сплатіть)\s+(?:за\s+)?\d*\s*повідомлен\p{L}*|(?:зір(?:ок|ки|ку)|зірк\p{L}*)\s+за\s+(?:кожне\s+)?(?:вхідне\s+)?повідомлен\p{L}*|(?:подтверд\p{L}*|подтвердите)\s+(?:оплат|платеж)\p{L}*|(?:оплатить|заплатить)\s+(?:за\s+)?\d*\s*сообщен\p{L}*|(?:звёзд|звезд)\p{L}*\s+за\s+(?:каждое\s+)?(?:входящее\s+)?сообщен\p{L}*)/iu;
// Кнопка оплати за підписом: «Pay for 1 message», «Сплатити …», будь-що із зіркою.
export const payButtonPattern = /(?:^pay\b|pay for|^сплатити|^оплатити|^оплатить|^заплатить|[★⭐])/iu;
// Плейсхолдер чи підпис поля платного чату: «Message for ★385».
export const paidComposerPattern = /(?:(?:message|send) for|повідомлення за|надіслати за|сообщение за|отправить за)\s*[★⭐]|[★⭐]\s*\d/iu;
// Єдина кнопка, яку адаптер тисне в діалозі оплати: «Cancel».
const cancelButtonPattern = /^(?:cancel|скасувати|скасуй|отмена|відміна)$/iu;
// Бот-модератор пише, до котрої години чат закритий: «до 7:00», «until 7». Шукаємо лише в повідомленнях про режим тиші.
const quietKeywordPattern = /(?:нічн|ночн|night|тиш[аіу]|тихий|silent|режим|mode|заборон|закрит|запрещ)/iu;
const quietUntilPattern = /(?<!\p{L})(?:до|until|till|по)\s+(\d{1,2})(?:[:.](\d{2}))?(?!\d)(?!\s*(?:хв|мин|min|сек|sec))/iu;

/** Година й хвилина «до …» з тексту бота-модератора; null, якщо не видно. Час вважаємо київським: точніше з повідомлення не дізнатись. */
export function parseQuietUntil(texts) {
  for (const raw of [...texts].reverse()) {
    const text = String(raw || '');
    if (!quietKeywordPattern.test(text)) continue;
    const match = text.match(quietUntilPattern);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  return null;
}
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

// Текст для введення: як у Бібліотеці, з порожніми рядками між абзацами (normalizeText їх склеює, і пост у Telegram виходив
// суцільним блоком, 2026-10-26). Зайві пробіли в кінці рядків і понад один порожній рядок поспіль прибираються.
function typingText(value) {
  return String(value || '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(/\u00a0/gu, ' ').replace(/[\u200b\u200e\u200f]/gu, '')
    .split('\n').map((line) => line.replace(/[ \t]+$/u, '')).join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function normalizeText(value) {
  return String(value || '').normalize('NFC').replace(/ /gu, ' ').replace(/[​‎‏]/gu, '').replace(/[ \t]+/gu, ' ').replace(/\s*\n\s*/gu, '\n').trim();
}

/** Клієнт вкладки Telegram Web: у фоні, без фокусу, без звуку (див. cdp-background.mjs). */
async function createTelegramPageClient(page) {
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  try { await enterBackgroundMode(client); } catch (error) { client.close(); throw error; }
  return client;
}

const permanentRestrictionPattern = /(?:admins? of this group have restricted your ability to send messages|sending messages is not allowed in this group|you can(?:no|')t send messages in this (?:group|chat)|only admins can send messages|адміністратори групи обмежили|администраторы группы ограничили|надсилати повідомлення в цій групі заборонено|отправлять сообщения в этой группе запрещено)/iu;


const MONTHS = new Map(Object.entries({
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5, липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
}));

/**
 * Дата, до якої адміни заборонили писати, з підвалу чату: «restricted you from messaging until Nov 14, 2026, 16:09» (en), «до 14 листопада
 * 2026 р., 16:09» (uk), «до 14 ноября 2026 г., 16:09» (ru), також «до 14.11.2026, 16:09». Час за часовим поясом браузера runner (так його показує
 * Telegram). Повертає epoch у секундах або null, якщо дату не вдалось розібрати. Рік не вказано — найближчий майбутній.
 */
export function parseRestrictionUntil(text, nowMs = Date.now()) {
  const source = String(text || '').replace(/\s+/g, ' ');
  let day; let month; let year = null; let hour; let minute; let meridiem = '';
  let match = source.match(/\buntil\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?,?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/u);
  if (match) { month = MONTHS.get(match[1].toLowerCase()); day = Number(match[2]); year = match[3] ? Number(match[3]) : null; hour = Number(match[4]); minute = Number(match[5]); meridiem = (match[6] || '').toLowerCase(); }
  if (!match) {
    match = source.match(/(?:^|[^а-яіїєґ])до\s+(\d{1,2})\s+([а-яіїєґ]{3,10})\.?(?:\s+(\d{4})(?:\s*(?:р|г)\.?)?)?,?\s+(?:о\s+|в\s+)?(\d{1,2}):(\d{2})/iu);
    if (match) { day = Number(match[1]); month = MONTHS.get(match[2].toLowerCase()); year = match[3] ? Number(match[3]) : null; hour = Number(match[4]); minute = Number(match[5]); }
  }
  if (!match) {
    match = source.match(/(?:^|[^а-яіїєґ])до\s+(\d{1,2})\.(\d{2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})/u);
    if (match) { day = Number(match[1]); month = Number(match[2]) - 1; year = Number(match[3]); hour = Number(match[4]); minute = Number(match[5]); }
  }
  if (!match || month === undefined || !(day >= 1 && day <= 31) || !(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const now = new Date(nowMs);
  let at = new Date(year ?? now.getFullYear(), month, day, hour, minute, 0, 0);
  if (year === null && at.getTime() <= nowMs) at = new Date(now.getFullYear() + 1, month, day, hour, minute, 0, 0);
  const seconds = Math.floor(at.getTime() / 1000);
  return Number.isFinite(seconds) && at.getMonth() === month ? seconds : null;
}

// Помилкове вікно Telegram Web після вставки фото («Something went wrong — This channel is private»): акаунт у каналі вже не має доступу.
const privateChannelPattern = /(?:channel|chat|group) is private|private (?:channel|chat|group)|канал приватний|чат приватний|канал приватный|чат приватный/iu;
// Медіа в чаті заборонені: це кнопка в полі, пункт меню вкладень («Posting media content is not allowed in this group») або текст помилки.
export const mediaForbiddenPattern = /(?:media|photos?|photo and video|вкладен|медіа|медиа).{0,40}(?:isn.?t|is not|not|n.?t) allowed|(?:posting|sending) media|медіа.{0,40}заборон|медиа.{0,40}запрещ|forbidden|не дозволено/iu;

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
    // Нова вкладка у фоні: активна вкладка власника не змінюється.
    const next = await openBackgroundTab(base, TELEGRAM_WEB);
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
  // Підвал «писати не можна» (\`.messaging-disabled\`): закрита гілка, нічний чи повільний режим, права чату. Живий розбір 2026-10-25:
  // у закритій гілці це \`.messaging-disabled.shown > .messaging-disabled-inner > span\` з текстом «The topic is closed».
  const disabledNode = middle ? [...middle.querySelectorAll('.messaging-disabled')].find(visible) : null;
  const disabled = disabledNode ? (disabledNode.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '';
  // Гілка, відкрита зараз, і її рядок у списку гілок зліва: значок замка в рядку — головна ознака закритої гілки (без залежності від мови).
  const threadId = (location.hash.match(/^#-?\\d+_(\\d+)/) || [])[1] || '';
  let topicLocked = false;
  if (threadId) {
    const link = [...document.querySelectorAll('#LeftColumn a.ListItem-button[href*="_"]')].find((a) => ((a.getAttribute('href') || '').match(/_(\\d+)$/) || [])[1] === threadId);
    const row = link && link.closest('.ListItem');
    topicLocked = Boolean(row && row.querySelector('.icon-lock-filled, [class*="icon-lock"]'));
  }
  return {
    disabled, threadId, topicLocked,
    url: location.href,
    auth: Boolean(document.querySelector('#auth-qr-form, #auth-phone-number-form, .auth-form')),
    ready: Boolean(document.getElementById('telegram-search-input')),
    // Емодзі в назві — картинки з alt: без їх підстановки слова склеюються («Украинцыв NRWКуплю…») і назва не збігається з Work OS.
    title: (() => { const node = header && header.querySelector('.fullName, h3, .title'); if (!node) return ''; const clone = node.cloneNode(true); clone.querySelectorAll('img[alt]').forEach((img) => { const alt = img.getAttribute('alt'); if (alt) img.replaceWith(document.createTextNode(alt)); }); return (clone.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200); })(),
    status: header ? ((header.querySelector('.status, .group-status') || {}).innerText || '').trim().slice(0, 120) : '',
    peerId: (peer && peer.getAttribute('data-peer-id')) || (location.hash.match(/^#(-?\\d+)/) || [])[1] || '',
    // Ознаки форуму, окрім списку гілок: панель форуму зліва й гілка в адресі. Якщо вони є, а список гілок не прочитався, у чат не пишемо.
    // Живий розбір форуму 2026-10-24: у режимі «як повідомлення» стрічка містить .topic-group з пігулкою .topic-pill (назва гілки), а
    // знизу замість поля стоїть «You can reply to messages in topics»; у режимі гілок зліва .Topic.
    // Найнадійніша ознака форуму — аватар у шапці з класом forum (перевірено наживо на трьох форумах і звичайному чаті).
    forumUi: Boolean(document.querySelector('#MiddleColumn .MiddleHeader .Avatar.forum, #MiddleColumn .topic-pill, #MiddleColumn .topic-group, #LeftColumn .ForumPanel, #LeftColumn .Topic'))
      || /reply to messages in topics|відповідати на повідомлення в темах|відповісти на повідомлення в темах|отвечать на сообщения в темах/i.test(footer)
      || /^#-?\\d+_\\d+/.test(location.hash),
    composer: Boolean(composer && visible(composer)),
    footer, notices,
  };
})()`;

/**
 * Форум чи ні: `true` — є ознака форуму (аватар forum, панель гілок, підказка в підвалі); `false` — ознак немає, а чат точно завантажився (шапка з аватаром
 * і назвою, поле повідомлення чи підвал прочитано), і так само за ≈1,5 с (`recheck`); `null` — чат не встиг домалюватись, відповіді немає.
 */
export async function detectForum(page, peerId, { recheck = true, sleepFn = sleep } = {}) {
  const AVATAR = `Boolean(document.querySelector('#MiddleColumn .MiddleHeader .Avatar'))`;
  const look = async () => {
    const state = await page.evaluate(READ_STATE_JS);
    let topics = await page.evaluate(readTopicsJs(peerId));
    const headerForum = Boolean(state.forumUi);
    for (let attempt = 0; attempt < 8 && headerForum && !(Array.isArray(topics) && topics.length); attempt += 1) { await sleepFn(300); topics = await page.evaluate(readTopicsJs(peerId)); }
    const avatar = Boolean(await page.evaluate(AVATAR));
    const forum = (Array.isArray(topics) && topics.length > 0) || headerForum;
    const loaded = avatar && Boolean(state.title) && (Boolean(state.composer) || Boolean(state.footer) || Boolean(state.disabled));
    return { forum, loaded, topics: Array.isArray(topics) ? topics : [] };
  };
  for (let attempt = 0; attempt < 12 && !(await page.evaluate(AVATAR)); attempt += 1) await sleepFn(350);
  await sleepFn(300);
  let first = await look();
  // Шапка чи підвал ще не домальовані: ще до ≈3 с, поки не з'явиться ознака форуму або чат не стане завантаженим.
  for (let attempt = 0; attempt < 6 && !first.forum && !first.loaded; attempt += 1) { await sleepFn(500); first = await look(); }
  if (first.forum) return { forum: true, topics: first.topics };
  if (!first.loaded) return { forum: null, topics: [] };
  if (!recheck) return { forum: false, topics: [] };
  await sleepFn(1500);
  const second = await look();
  if (second.forum) return { forum: true, topics: second.topics };
  return second.loaded ? { forum: false, topics: [] } : { forum: null, topics: [] };
}

// Гілки форуму. Telegram Web A показує повний список гілок у лівій колонці, поки відкритий форум (живий розбір 2026-10-25, два форуми):
// рядок `#LeftColumn .ListItem.Chat > a.ListItem-button[href="#<чат>_<гілка>"]`, назва в `h3.fullName`, загальна гілка має href `…_1` і
// значок `general-forum-icon`. Список віртуальний (рядки з `style="top:…"`, 65 px на рядок) і лежить у `.chat-list.custom-scroll`.
// «Закрита» гілка — лише з явною ознакою: значок замка `icon-lock-filled` у рядку (перевірено на реальній закритій гілці «Правила
// размещения объявлений»: у відкритому вигляді в підвалі `.messaging-disabled` текст «The topic is closed»). Відсутність поля
// повідомлення закритістю не вважається: нічний і повільний режими, права чату дають таке саме порожнє місце.
export const readTopicsJs = (peerId) => `(() => {
  const peer = ${JSON.stringify(String(peerId || ''))};
  const rows = [...document.querySelectorAll('#LeftColumn a.ListItem-button[href*="_"]')];
  const seen = new Set();
  const topics = [];
  for (const link of rows) {
    const match = (link.getAttribute('href') || '').match(/^#(-?\\d+)_(\\d{1,18})$/);
    if (!match || (peer && match[1] !== peer) || seen.has(match[2])) continue;
    const node = link.closest('.ListItem');
    const nameNode = node && node.querySelector('h3.fullName');
    if (!nameNode) continue;
    const clone = nameNode.cloneNode(true);
    clone.querySelectorAll('img[alt]').forEach((img) => { const alt = img.getAttribute('alt'); if (alt) img.replaceWith(document.createTextNode(alt)); });
    const title = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!title) continue;
    seen.add(match[2]);
    topics.push({ id: match[2], title: title.slice(0, 120), closed: Boolean(node.querySelector('.icon-lock-filled, [class*="icon-lock"]')) });
  }
  return topics;
})()`;

// Прокрутка віртуального списку гілок: до кінця, щоб підвантажились усі рядки. Повертає, чи довелось гортати далі.
const SCROLL_TOPICS_JS = `(() => {
  const link = document.querySelector('#LeftColumn a.ListItem-button[href*="_"]');
  let el = link && link.closest('.ListItem');
  while (el && el.id !== 'LeftColumn' && !(el.scrollHeight > el.clientHeight + 5 && !['visible', 'hidden'].includes(getComputedStyle(el).overflowY))) el = el.parentElement;
  if (!el || el.id === 'LeftColumn') return { ok: false, atEnd: true };
  const before = el.scrollTop;
  el.scrollTop = el.scrollHeight;
  return { ok: true, atEnd: el.scrollTop <= before + 2 };
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
/** Самолікування: перезавантажує вкладку Telegram Web (створює, якщо її немає) і чекає, поки застосунок стартує. */
export async function reloadTelegramTabViaCdp({ cdpBaseUrl } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  const found = await findTelegramPage(base, { create: true });
  if (found.kind !== 'result') return found;
  const client = await createTelegramPageClient(found.page);
  try {
    await client.send('Page.enable');
    await client.send('Page.navigate', { url: TELEGRAM_WEB });
    await sleep(10_000);
    return { kind: 'result' };
  } finally { try { client.close(); } catch { /* вкладка вже закрита */ } }
}

export async function readTelegramIdentityViaCdp({ cdpBaseUrl } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  // Лише дивимось на вже відкриту вкладку: вкладку для статусу не створюємо.
  const found = await findTelegramPage(base, { create: false });
  if (found.kind !== 'result') return found;
  const client = await createTelegramPageClient(found.page);
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
export async function sendTelegramAutopostViaCdp(task, { cdpBaseUrl, shouldAbort = () => false, onStep = () => {}, verifyOnly = false, scanOnly = false, checkOnly = false, anyTitle = false, sinceEpoch = 0 } = {}) {
  const base = cdpBaseUrl ? normalizeLocalCdpBaseUrl(cdpBaseUrl) : null;
  if (!base) return { kind: 'blocked', reason: 'cdp_not_configured' };
  const text = normalizeText(task?.material?.text);
  const typed = typingText(task?.material?.text);
  // Прохід «знайти гілки» тексту не має: він лише дивиться на чат.
  if (!text && !scanOnly) return { kind: 'blocked', reason: 'stale_precondition' };
  let media = task?.material?.media?.base64 ? task.material.media : null;
  if (!verifyOnly && Array.from(typed).length > MAX_MESSAGE_CHARS) return { kind: 'blocked', reason: 'telegram_text_too_long' };
  // Підпис до фото в Telegram — до 1024 символів: довший не обрізаємо, а не надсилаємо.
  if (!verifyOnly && media && Array.from(typed).length > MAX_CAPTION_CHARS) return { kind: 'blocked', reason: 'telegram_caption_too_long' };
  const target = telegramOpenTarget(task?.target?.expectedLink);
  if (!target) return { kind: 'blocked', reason: 'telegram_chat_missing', detail: 'link_not_recognised' };
  const found = await findTelegramPage(base);
  if (found.kind !== 'result') return found;
  const client = await createTelegramPageClient(found.page);
  const page = new TelegramPage(client);
  const startedAt = Date.now();
  const deadlineAt = startedAt + 120_000;
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable').catch(() => {});
    // Вкладка у фоні: фокус емулюється при створенні клієнта (createTelegramPageClient), вікно не піднімається. Широкий екран потрібен, щоб лівий список (гілки) був видимий.
    await client.send('Emulation.setDeviceMetricsOverride', WIDE_VIEWPORT);

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
    for (let again = 0; again < 2 && opened.stalled; again += 1) {
      await openFresh(client, url);
      opened = await waitForOpenChat(page, shouldAbort, Math.min(deadlineAt, Date.now() + OPEN_CHAT_TIMEOUT_MS), again === 0 ? 7_000 : 0);
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
    // Вікна від попередньої спроби (вікно фото, помилка, діалог оплати): закриваємо до будь-якого кліку. Діалог оплати означає платний чат.
    const leftoverPaid = await clearLeftoverModals(page);
    if (leftoverPaid) return { kind: 'blocked', reason: 'telegram_paid_messages', observedTarget, detail: `leftover: ${leftoverPaid}`.slice(0, 300), sendAttempted: false };

    // 3. Форум чи ні й гілки (закриті позначені). Форум без вибраної гілки в чат не пишемо: публікація в «Загальну» замість потрібної гілки
    // гірша за пропуск, тож і форум, чий список гілок не прочитався, іде на вибір гілки.
    // Шапка з аватаром малюється трохи пізніше за назву: без неї ознака форуму ще не видна, і форум помилково вважався б звичайним чатом (так «Українці в
    // регіоні Harz» отримали `telegram_forum=0`). «Ні» вважається відповіддю лише для чату, що точно завантажився; інакше форум невідомий (`null`).
    const rootUrl = peerId ? `${TELEGRAM_WEB}#${peerId}` : url;
    const detected = await detectForum(page, peerId, { recheck: scanOnly || task?.telegram?.forum !== false });
    const forum = detected.forum;
    const chosen = task?.telegram?.thread || null;
    const knownTopics = Array.isArray(task?.telegram?.topics) ? task.telegram.topics : [];
    // Список гілок збираємо, лише коли гілку ще не вибрано (або для діагностики): для вибраної він уже збережений.
    let topics = [];
    if (forum) {
      onStep('topics', 'збираю гілки чату');
      // Список гілок збирає окремий прохід (scanOnly) і задача публікації в чат, який досі вважався звичайним чи ще не відкривався (знайшли ознаки форуму):
      // тоді публікації не буде, чат піде на вибір гілки зі свіжим списком. Для відомого форуму береться збережений список.
      const collect = scanOnly || task?.telegram?.forum !== true;
      topics = collect ? await collectTopics(page, client, peerId, rootUrl, shouldAbort, Math.min(deadlineAt, startedAt + SCAN_BUDGET_MS), knownTopics) : knownTopics;
    }
    // Форум не вдалося визначити: прохід нічого не записує (telegram_forum лишається як був), публікація не йде наосліп, а повторюється після перезавантаження вкладки.
    let scan = { forum, topics };
    if (forum === null && !scanOnly) return { kind: 'blocked', reason: 'telegram_chat_not_opened', detail: 'forum_unknown', observedTarget, scan: { forum: null, topics: [] }, sendAttempted: false };
    // sendAttempted: кнопку «Надіслати» вже натиснуто. Лише тоді задача займає вікно інтервалу «N на годину»; збій до натискання його не витрачає.
    let sendAttempted = false;
    const withScan = (extra) => ({ ...extra, observedTarget, scan, sendAttempted });
    // Чат, який вважався звичайним, а підвал чи стан поля показали форум: збираємо гілки й віддаємо чат на вибір гілки (`thread_required`), публікації немає.
    const forumFromHint = async (detail) => {
      onStep('topics', 'збираю гілки чату');
      const found = await collectTopics(page, client, peerId, rootUrl, shouldAbort, Math.min(deadlineAt, startedAt + SCAN_BUDGET_MS), knownTopics);
      scan = { forum: true, topics: found };
      return withScan({ kind: 'blocked', reason: 'thread_required', detail: String(detail || '').slice(0, 200) });
    };
    if (forum && !scanOnly) {
      if (!chosen) return withScan({ kind: 'blocked', reason: 'thread_required' });
      const known = topics.find((item) => item.id === chosen.id);
      if (known?.closed) return withScan({ kind: 'blocked', reason: 'thread_closed', detail: 'closed' });
      if (!peerId) return withScan({ kind: 'blocked', reason: 'telegram_thread_not_opened', detail: 'peer_id_unknown' });
      onStep('thread', `відкриваю гілку «${chosen.title || chosen.id}»`);
      // Telegram Web інколи «з'їдає» глибоке посилання на гілку (адреса лишається порожньою): до трьох спроб, як і для самого чату.
      let topicState = {};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await openFresh(client, telegramWebUrl({ kind: 'private', peerId }, chosen.id));
        const inTopic = await waitForOpenChat(page, shouldAbort, Math.min(deadlineAt, Date.now() + OPEN_CHAT_TIMEOUT_MS), 7_000);
        if (inTopic.aborted) return withScan({ kind: 'blocked', reason: 'cancelled' });
        topicState = inTopic.state || {};
        // Під час запуску застосунок на мить скидає адресу до порожньої (чат уже намальовано, а `_<гілка>` ще не повернулась): чекаємо до 4 с.
        for (let poll = 0; poll < 10 && !inTopic.timedOut && !(topicState.url || '').includes(`_${chosen.id}`); poll += 1) { await sleep(400); topicState = await page.evaluate(READ_STATE_JS); }
        if (!inTopic.timedOut && (topicState.url || '').includes(`_${chosen.id}`)) break;
      }
      if (!(topicState.url || '').includes(`_${chosen.id}`)) return withScan({ kind: 'blocked', reason: 'telegram_thread_not_opened', detail: topicState.url || '' });
    }

    // Лише зібрати відомості про чат (форум чи ні, гілки), нічого не читаючи далі й не пишучи: для діагностики.
    if (scanOnly) {
      // Чи можна зараз писати в чат узагалі: корінь без поля й з підвалом «писати не можна» (нічний режим, права) — тимчасова заборона.
      const root = await page.evaluate(READ_STATE_JS);
      scan = { ...scan, restricted: !root.composer && Boolean(root.disabled) && !topicClosedPattern.test(root.disabled) && !forumHintPattern.test(root.disabled) && !/^\s*(?:join|приєднатися|присоединиться)/iu.test(root.disabled) };
      return withScan({ kind: 'blocked', reason: 'scan_only' });
    }
    // `await` обов'язковий: без нього `finally` закрив би з'єднання, поки перевірка ще гортає стрічку.
    if (verifyOnly) return await verifyOwnMessage(page, text, sinceEpoch, withScan, shouldAbort, deadlineAt);

    // 4. Чи можна тут писати.
    // Поле повідомлення монтується не одразу (у гілці — після переходу): чекаємо до 6 с, і лише коли сторінка справді в потрібній гілці
    // (в адресі `_<id>`), а не на перехідному екрані, перш ніж вирішувати, що писати не можна.
    const inWantedThread = (state) => !(forum && chosen) || state.threadId === chosen.id;
    let writable = await page.evaluate(READ_STATE_JS);
    for (let attempt = 0; attempt < 15 && !(writable.composer && inWantedThread(writable)); attempt += 1) {
      // Підвал «писати не можна» вже видно у правильній гілці: далі чекати нічого.
      if (!writable.composer && inWantedThread(writable) && writable.disabled && attempt >= 3) break;
      await sleep(400); writable = await page.evaluate(READ_STATE_JS);
    }
    if (forum && chosen && writable.threadId !== chosen.id) return withScan({ kind: 'blocked', reason: 'telegram_thread_not_opened', detail: writable.url || '' });
    // Підвал «You can reply to messages in topics» — це форум, навіть якщо шапка не показала аватар форуму: пишемо не в чат, а збираємо гілки й віддаємо чат
    // на вибір гілки (а не «зараз писати не можна»). Без цього форуми з `telegram_forum=0` щоразу падали однаково.
    if (!forum && forumHintPattern.test(`${writable.footer || ''} ${writable.disabled || ''}`)) return await forumFromHint(`footer: ${writable.footer || writable.disabled}`);
    const blockedText = `${writable.footer || ''} ${writable.notices || ''}`;
    if (!writable.composer) {
      // Закрита гілка — лише за явною ознакою: значок замка в списку гілок або текст «топік закрито» в підвалі.
      if (forum && chosen && (writable.topicLocked || topicClosedPattern.test(writable.disabled || ''))) {
        scan = { forum, topics: topics.some((item) => item.id === chosen.id) ? topics.map((item) => (item.id === chosen.id ? { ...item, closed: true } : item)) : [...topics, { id: chosen.id, title: chosen.title || chosen.id, closed: true }] };
        return withScan({ kind: 'blocked', reason: 'thread_closed', detail: writable.topicLocked ? 'lock' : 'footer' });
      }
      if (bannedPattern.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_banned', detail: blockedText });
      if (slowModePattern.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_slow_mode', detail: blockedText });
      // Кнопка вступу замість поля: акаунт не в чаті. Це не «пишуть лише адміни», тож чат не архівуємо, а віддаємо власнику.
      if (/^\s*(?:join|приєднатися|присоединиться)/iu.test(writable.footer || '')) return withScan({ kind: 'blocked', reason: 'telegram_no_access', detail: blockedText });
      // Є підвал «писати не можна», але це не закрита гілка: нічний режим бота, права чату, «лише адміни» на весь чат. Тимчасова заборона:
      // чат відкладається (без архіву й без «Не вдалося»), а гілки лишаються відкритими.
      if (writable.disabled || readOnlyPattern.test(blockedText)) {
        const messages = await page.evaluate(READ_MESSAGES_JS).catch(() => []);
        const resume = parseQuietUntil((Array.isArray(messages) ? messages : []).filter((item) => !item.own).slice(-6).map((item) => item.text));
        // Без підказки бота «до 7:00» і з прямим текстом «адміни обмежили / писати не можна» це не тимчасова заборона, а постійне обмеження
        // акаунта в чаті (бан писати, без дати закінчення): чат іде в архів «Забанено», а не відкладається щодня.
        // Адміни заборонили писати «до дати» (restricted you from messaging until Nov 14, 2026, 16:09): дату віддаємо серверу, він вирішує за правилом 7 днів.
        const restrictedUntil = parseRestrictionUntil(blockedText);
        if (!resume && !restrictedUntil && permanentRestrictionPattern.test(blockedText) && !/\b(?:until|до)\s+\S/iu.test(blockedText)) return withScan({ kind: 'blocked', reason: 'telegram_write_banned', detail: blockedText.trim() || writable.disabled });
        scan = { ...scan, restricted: true };
        return withScan({ kind: 'blocked', reason: 'telegram_chat_restricted', detail: blockedText.trim() || writable.disabled, ...(restrictedUntil ? { restrictedUntil } : {}), ...(resume ? { resumeHour: resume.hour, resumeMinute: resume.minute } : {}) });
      }
      return withScan({ kind: 'blocked', reason: 'telegram_composer_not_found', detail: blockedText });
    }
    // Платний чат (Telegram Stars): ознака видна ще до введення чого-небудь (плейсхолдер «Message for ★385», кнопка з зіркою). Нічого не вставляємо й не тиснемо.
    let paidState = await readPaidState(page);
    if (!paidState.paid) { await sleep(500); paidState = await readPaidState(page); }
    if (paidState.paid) return withScan({ kind: 'blocked', reason: 'telegram_paid_messages', detail: paidState.why });
    // Поле є: тимчасова заборона чату знята (позначка в Work OS очищається разом з будь-яким результатом цього чату).
    scan = { ...scan, restricted: false };
    // Лише перевірити, що в чат (гілку) можна писати: текст не вводиться й нічого не надсилається (діагностика на живих чатах).
    if (checkOnly) return withScan({ kind: 'blocked', reason: 'check_only_writable' });
    if (shouldAbort()) return withScan({ kind: 'blocked', reason: 'cancelled' });

    // 5. Фото (якщо є): вставка в поле відкриває вікно «Send Photo» з власним полем підпису. Далі текст (рядки через Shift+Enter) і звірка.
    const before = await page.evaluate(READ_MESSAGES_JS);
    const beforeIds = new Set(before.map((item) => item.id));
    let field = '#editable-message-text';
    // У групі, де адміни заборонили медіа, у полі стоїть кнопка «Sending media isn't allowed in this group» і вставка фото нічого не відкриває
    // (перевірено наживо 2026-10-26, «Чат Мандарин Медіа»). Оголошення тоді йде лише текстом: це кращий результат, ніж вічний повтор.
    if (media && await page.evaluate(`[...document.querySelectorAll('#MiddleColumn .Composer button, #MiddleColumn .Composer .Button')].some((node) => /(?:media|photos?|photo and video).{0,20}(?:isn.?t|not|n.?t) allowed|медіа.{0,30}заборон|медиа.{0,30}запрещ/i.test(node.getAttribute('aria-label') || node.getAttribute('title') || ''))`)) {
      media = null;
      onStep('photo', 'у цій групі медіа заборонені: публікую лише текст');
    }
    if (media) {
      onStep('photo', 'додаю фото');
      const pasteScript = `(() => { const node = document.querySelector('#editable-message-text'); if (!node || typeof DataTransfer === 'undefined') return false;
        try { const raw = atob(${JSON.stringify(String(media.base64))}); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
          const file = new File([bytes], ${JSON.stringify(String(media.fileName || 'work-os.jpg'))}, { type: ${JSON.stringify(String(media.contentType || 'image/jpeg'))} });
          const transfer = new DataTransfer(); transfer.items.add(file); node.focus();
          node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); return true; } catch { return false; } })()`;
      const pasted = await page.evaluate(pasteScript);
      let opened = false;
      let menuChecked = false;
      // Вікно фото інколи відкривається повільно (Telegram Web у фоні): чекаємо до ≈30 с і один раз вставляємо фото ще раз, якщо за 12 с вікна немає.
      // Раніше, ніж чекати далі, перевіряємо дві відомі причини, чому воно не відкриється (наживо 2026-11-06, 118 збоїв у журналі):
      // помилкове вікно «This channel is private» (акаунт без доступу) і заборонені медіа, про які каже лише меню вкладень.
      for (let attempt = 0; pasted && attempt < 75 && !opened; attempt += 1) {
        opened = Boolean(await page.evaluate(`Boolean(document.querySelector('.Modal #editable-message-text-modal'))`));
        if (opened) break;
        const errorText = String(await page.evaluate(`(() => { const modal = [...document.querySelectorAll('.Modal')].find((node) => !node.querySelector('#editable-message-text-modal')); return modal ? (modal.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : ''; })()`) || '');
        if (errorText) {
          await closeErrorModal(page);
          if (privateChannelPattern.test(errorText)) return withScan({ kind: 'blocked', reason: 'telegram_no_access', detail: errorText });
          if (mediaForbiddenPattern.test(errorText)) { media = null; onStep('photo', 'у цій групі медіа заборонені: публікую лише текст'); break; }
          return withScan({ kind: 'blocked', reason: 'telegram_attachment_not_opened', detail: JSON.stringify({ modalText: errorText }) });
        }
        if (!menuChecked && attempt >= 6) {
          menuChecked = true;
          if (await attachMenuForbidsMedia(page)) { media = null; onStep('photo', 'у цій групі медіа заборонені: публікую лише текст'); break; }
        }
        if (attempt === 30) await page.evaluate(pasteScript);
        await sleep(400);
      }
      if (media && !opened) {
        // Діагностика: що саме стоїть у полі, коли вікно фото не відкрилось (заборона медіа, інша мова підпису кнопки, довгий запуск вікна).
        const state = await page.evaluate(`JSON.stringify({pasted:${pasted ? 'true' : 'false'},modal:Boolean(document.querySelector('.Modal')),composer:(document.querySelector('#MiddleColumn .Composer')||{}).innerText||'',buttons:[...document.querySelectorAll('#MiddleColumn .Composer button, #MiddleColumn .Composer .Button')].map((n)=>(n.getAttribute('aria-label')||n.innerText||'').trim()).filter(Boolean).slice(0,10),footer:(document.querySelector('.messaging-disabled')||{}).innerText||''})`).catch(() => '');
        await discardAttachment(page);
        const paidLate = await paymentGuard(page);
        if (paidLate) return withScan({ kind: 'blocked', reason: 'telegram_paid_messages', detail: paidLate.slice(0, 300) });
        // Вікно фото не відкрилось, бо це форум без вибраної гілки (вставка в «корінь» нічого не відкриває): форум, а не збій екрана.
        if (!forum && forumHintPattern.test(String(state))) return await forumFromHint(`attachment: ${state}`);
        return withScan({ kind: 'blocked', reason: 'telegram_attachment_not_opened', detail: String(state).slice(0, 500) });
      }
      if (media) { await sleep(600); field = '#editable-message-text-modal'; }
      if (media) {
        const paidModal = await paymentGuard(page);
        if (paidModal) { await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'telegram_paid_messages', detail: paidModal.slice(0, 300) }); }
      }
    }
    onStep('text', 'вводжу текст');
    if (!await page.click(`document.querySelector(${JSON.stringify(field)})`)) { if (media) await discardAttachment(page); return withScan({ kind: 'blocked', reason: 'telegram_composer_not_found' }); }
    await page.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(field)}); node.focus(); const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('delete'); return true; })()`);
    const lines = typed.split('\n');
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
    // Перед кліком ще раз: ні діалогу оплати, ні платної кнопки (чат міг стати платним, поки йшла підготовка). Підпис оголошення в перевірці не бере участі.
    const cancelPaid = async (detail) => {
      // Нічого не надіслано: тиснемо лише «Cancel», вікно фото й чернетку в полі прибираємо.
      if (media) await discardAttachment(page);
      else await page.evaluate(`(() => { const node = document.querySelector('#editable-message-text'); if (!node) return false; node.focus(); const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('delete'); return true; })()`).catch(() => {});
      sendAttempted = false;
      return withScan({ kind: 'blocked', reason: 'telegram_paid_messages', detail: String(detail || '').slice(0, 300) });
    };
    const paidBefore = await paymentGuard(page);
    if (paidBefore) return await cancelPaid(paidBefore);
    const paidButton = await readPaidState(page, { withText: false });
    if (paidButton.paid) return await cancelPaid(paidButton.why);
    onStep('send', 'надсилаю');
    const clicked = await page.click(media
      ? SAFE_PHOTO_SEND_EXPR
      : `(() => { const buttons = [...document.querySelectorAll('#MiddleColumn button, #MiddleColumn .Button')];
        return buttons.find((el) => el.classList.contains('send') && !el.disabled) || buttons.find((el) => /^(send message|надіслати повідомлення|отправить сообщение)$/iu.test(el.getAttribute('aria-label') || el.title || '')) || null; })()`);
    sendAttempted = true;
    if (!clicked && media) {
      // Безпечної кнопки немає (поверх вікна фото відкрито ще одне вікно чи кнопка з зіркою): нічого не тиснемо навмання, дивимось, що це.
      const blocker = await paymentGuard(page);
      sendAttempted = false;
      if (blocker) return await cancelPaid(blocker);
    } else if (!clicked) {
      await page.key('Enter', 'Enter', 13);
    } else if (media) {
      // Вікно фото закривається, щойно Telegram прийняв відправку. Якщо воно ще відкрите через кілька секунд, клік не подіяв (фото ще
      // обробляється): тиснемо ще раз, до трьох разів. Поки вікно відкрите, нічого не надіслано, тож дубля не буде.
      // Перед кожним повторним кліком — діалог оплати: його закриваємо «Cancel», а кнопка вікна фото тиснеться лише через SAFE_PHOTO_SEND_EXPR.
      for (let again = 0; again < 2; again += 1) {
        await sleep(3_000);
        const paidAgain = await paymentGuard(page);
        if (paidAgain) return await cancelPaid(paidAgain);
        if (!await page.evaluate(`Boolean(document.querySelector('.Modal #editable-message-text-modal'))`)) break;
        await page.click(SAFE_PHOTO_SEND_EXPR);
      }
    }

    // 7. Підтвердження: своє повідомлення з цим текстом у стрічці цієї гілки, вже не «годинник». З фото чекаємо довше: воно вантажиться.
    onStep('confirm', 'перевіряю, що повідомлення в чаті');
    const wanted = squash(text).slice(0, 40);
    const confirmDeadline = Date.now() + (media ? PHOTO_CONFIRM_TIMEOUT_MS : SEND_CONFIRM_TIMEOUT_MS);
    while (Date.now() < confirmDeadline) {
      await sleep(POLL_MS);
      // Діалог оплати міг з'явитись після кліку «Надіслати»: закриваємо «Cancel», нічого не сплачуємо.
      const paidLoop = await paymentGuard(page);
      if (paidLoop) return await cancelPaid(paidLoop);
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
    const paidLate = await paymentGuard(page);
    if (paidLate) return await cancelPaid(paidLate);
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

// Усі видимі модальні вікна: чи це вікно відправки фото (є поле підпису), текст і підписи кнопок. Платіжний діалог розпізнається тут.
export const READ_MODALS_JS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const nodes = [...document.querySelectorAll('.Modal, .modal-dialog, [role="dialog"]')].filter(visible);
  return nodes.map((node) => ({
    editor: Boolean(node.querySelector('#editable-message-text-modal')),
    text: (node.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
    buttons: [...node.querySelectorAll('button, .Button')].filter(visible).map((el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 80)).filter(Boolean),
  }));
})()`;

/** Чи це діалог оплати зірками (за текстом чи за кнопкою оплати), а не вікно відправки фото чи помилка. */
export function isPaidModal(modal) {
  if (!modal) return false;
  if ((modal.buttons || []).some((label) => payButtonPattern.test(String(label)))) return true;
  // Текст оголошення в полі підпису вікна фото не рахується: платіжний діалог — окреме вікно без поля підпису.
  return !modal.editor && paidDialogPattern.test(String(modal.text || ''));
}

// Ознаки платного чату в самому полі повідомлення: клас кнопки (`has-paid-stars paid`, живий знімок 2026-11-10) і плейсхолдер «Message for ★385».
// `withText: false` після набору тексту: підпис оголошення не має бути приводом для хибної тривоги.
export const paidProbeJs = (withText) => `(() => {
  const root = document.querySelector('#MiddleColumn .Composer');
  const field = document.querySelector('#editable-message-text');
  const buttons = root ? [...root.querySelectorAll('button, .Button')] : [];
  const buttonPaid = buttons.some((el) => /(?:^|\\s)(?:has-paid-stars|paid)(?:\\s|$)/.test(typeof el.className === 'string' ? el.className : ''));
  const parts = [];
  if (field) parts.push(field.getAttribute('data-placeholder') || '', field.getAttribute('placeholder') || '', field.getAttribute('aria-label') || '');
  if (${withText ? 'true' : 'false'} && root) {
    for (const node of root.querySelectorAll('.placeholder-text, [class*="placeholder"]')) parts.push(node.innerText || node.textContent || '');
    if (field && !(field.innerText || '').trim()) parts.push(root.innerText || '');
  }
  const labels = buttons.map((el) => el.getAttribute('aria-label') || el.title || '').filter(Boolean);
  return { buttonPaid, text: parts.join(' | ').replace(/\\s+/g, ' ').trim().slice(0, 200), labels: labels.join(' | ').slice(0, 200) };
})()`;

/** Платний чат: так / ні + чим видно (для журналу). */
export async function readPaidState(page, { withText = true } = {}) {
  const state = await page.evaluate(paidProbeJs(withText)).catch(() => null);
  if (!state) return { paid: false, why: '' };
  if (state.buttonPaid) return { paid: true, why: 'send_button_paid' };
  if (paidComposerPattern.test(String(state.text || ''))) return { paid: true, why: `placeholder: ${state.text}` };
  if (paidComposerPattern.test(String(state.labels || ''))) return { paid: true, why: `button: ${state.labels}` };
  return { paid: false, why: '' };
}

// «Cancel» у діалозі оплати: лише кнопка з таким підписом всередині вікна, текст якого збігається з ознаками оплати. Кнопку оплати вираз не вибере ніколи.
const CANCEL_PAID_EXPR = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const paid = new RegExp(${JSON.stringify(paidDialogPattern.source)}, 'iu');
  const cancel = new RegExp(${JSON.stringify(cancelButtonPattern.source)}, 'iu');
  const pay = new RegExp(${JSON.stringify(payButtonPattern.source)}, 'iu');
  const modals = [...document.querySelectorAll('.Modal')].filter(visible).filter((node) => !node.querySelector('#editable-message-text-modal'));
  for (const modal of modals) {
    const buttons = [...modal.querySelectorAll('button, .Button')].filter(visible);
    if (!(paid.test((modal.innerText || '').replace(/\\s+/g, ' ')) || buttons.some((el) => pay.test((el.innerText || '').trim())))) continue;
    const found = buttons.find((el) => cancel.test((el.innerText || el.getAttribute('aria-label') || '').trim()) && !pay.test((el.innerText || '').trim()));
    if (found) return found;
  }
  return null;
})()`;

// Кнопка відправки вікна фото. Тиснемо лише коли відкрите єдине вікно (з полем підпису) і на кнопці немає зірки: будь-яке інше вікно поверх нього
// (оплата, помилка) означає «не тиснути». Раніше тут була будь-яка `.Modal button.primary`, і нею могла виявитись кнопка «Pay for 1 message».
export const SAFE_PHOTO_SEND_EXPR = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const modals = [...document.querySelectorAll('.Modal')].filter(visible);
  const editor = modals.find((node) => node.querySelector('#editable-message-text-modal'));
  if (!editor || modals.some((node) => node !== editor)) return null;
  const pay = new RegExp(${JSON.stringify(payButtonPattern.source)}, 'iu');
  const button = [...editor.querySelectorAll('button.primary')].filter((el) => !el.disabled && visible(el)).pop();
  if (!button) return null;
  if (pay.test((button.innerText || button.getAttribute('aria-label') || '').trim())) return null;
  return button;
})()`;

/**
 * Діалог оплати на екрані (чи платна кнопка у вікні): закриваємо «Cancel» (чи Escape), оплату не торкаємось. Повертає короткий опис знайденого або ''.
 * Далі викликач прибирає вікно фото й віддає `telegram_paid_messages`.
 */
export async function paymentGuard(page) {
  const modals = await page.evaluate(READ_MODALS_JS).catch(() => []);
  const paid = (Array.isArray(modals) ? modals : []).filter(isPaidModal);
  if (!paid.length) return '';
  const detail = paid.map((modal) => String(modal.text || '').slice(0, 160)).join(' | ');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.click(CANCEL_PAID_EXPR).catch(() => false);
    if (!clicked) await page.key('Escape', 'Escape', 27).catch(() => {});
    await sleep(500);
    const left = await page.evaluate(READ_MODALS_JS).catch(() => []);
    if (!(Array.isArray(left) ? left : []).some(isPaidModal)) break;
  }
  return detail || 'paid_dialog';
}

// Вікна, що лишились від попередньої спроби (після перепідключення runner чи збою): платіжний діалог закривається «Cancel» і означає платний чат,
// вікно фото чи помилка — закриваються. Без цього повторна спроба тиснула б головну кнопку чужого вікна.
async function clearLeftoverModals(page) {
  const modals = await page.evaluate(READ_MODALS_JS).catch(() => []);
  if (!Array.isArray(modals) || !modals.length) return '';
  const paidDetail = await paymentGuard(page);
  await discardAttachment(page);
  await closeErrorModal(page);
  return paidDetail;
}

// Помилкове вікно Telegram Web («Something went wrong»): закриваємо кнопкою «OK», інакше Escape.
async function closeErrorModal(page) {
  try {
    const clicked = await page.click(`[...document.querySelectorAll('.Modal button')].find((el) => /^(?:ok|ок|закрити|закрыть|close)$/iu.test((el.innerText || '').trim()))`);
    if (!clicked) await page.key('Escape', 'Escape', 27);
    await sleep(400);
    if (await page.evaluate(`Boolean(document.querySelector('.Modal'))`)) await page.key('Escape', 'Escape', 27);
  } catch { /* вкладка вже закрита */ }
}

// Меню «Add attachment» у чаті, де медіа заборонені, містить пункт «Posting media content is not allowed in this group» замість «Photo or Video»
// (наживо 2026-11-06, «Новини Львова»): вставка фото там мовчки нічого не відкриває. Меню відкривається справжнім кліком і закривається Escape.
async function attachMenuForbidsMedia(page) {
  try {
    if (!await page.click(`document.querySelector('#MiddleColumn .Composer button[aria-label="Add attachment"], #MiddleColumn .Composer button[aria-label="Attach"]')`)) return false;
    await sleep(700);
    const items = String(await page.evaluate(`[...document.querySelectorAll('.Composer .MenuItem, .bubble .MenuItem, .Menu .MenuItem')].map((el) => (el.innerText || '').trim()).join(' | ')`) || '');
    await page.key('Escape', 'Escape', 27);
    await sleep(300);
    return /photo or video|фото або відео|фото или видео/iu.test(items) ? false : mediaForbiddenPattern.test(items);
  } catch { return false; }
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

// Список гілок форуму: повний, з лівої колонки (рядки віртуальні, тож гортаємо до кінця, поки кількість росте), без кліків по кожній гілці.
// Запасний шлях, коли лівої панелі немає, — пігулки гілок у стрічці (`.topic-pill`, лише гілки з недавніми повідомленнями): id беремо з
// адреси після кліку. «Закрита» тут — лише явна ознака: значок замка в списку або підвал «топік закрито»; порожнє місце поля не рахується.
async function collectTopics(page, client, peerId, rootUrl, shouldAbort, budgetUntil, known = []) {
  let panel = await page.evaluate(readTopicsJs(peerId));
  if (Array.isArray(panel) && panel.length) {
    // Telegram підвантажує гілки порціями: гортаємо вниз, поки з'являються нові рядки (у межах бюджету часу).
    let stable = 0;
    for (let round = 0; round < 40 && stable < 2 && Date.now() < budgetUntil && !shouldAbort(); round += 1) {
      const scrolled = await page.evaluate(SCROLL_TOPICS_JS);
      await sleep(350);
      const next = await page.evaluate(readTopicsJs(peerId));
      const grew = next.length > panel.length;
      if (next.length >= panel.length) panel = next;
      stable = !grew && scrolled?.atEnd ? stable + 1 : 0;
    }
    // Повертаємо список на початок: далі чат відкривається заново, але вручну відкритий форум лишиться охайним.
    await page.evaluate(`(() => { const link = document.querySelector('#LeftColumn a.ListItem-button[href*="_"]'); let el = link && link.closest('.ListItem');
      while (el && el.id !== 'LeftColumn' && !(el.scrollHeight > el.clientHeight + 5)) el = el.parentElement; if (el && el.id !== 'LeftColumn') el.scrollTop = 0; })()`).catch(() => {});
    return panel;
  }
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
      // Поле повідомлення чи підвал зʼявляється не одразу, а гілка закрита лише за явною ознакою: замок у списку або текст «топік закрито».
      let state = await page.evaluate(READ_STATE_JS);
      for (let attempt = 0; attempt < 24 && !state.composer && !state.disabled && !state.topicLocked; attempt += 1) { await sleep(250); state = await page.evaluate(READ_STATE_JS); }
      topics.push({ id, title: title.slice(0, 120), closed: Boolean(!state.composer && (state.topicLocked || topicClosedPattern.test(state.disabled || ''))) });
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
