// Автопост у Viber через Android у Waydroid: runner керує застосунком Viber за допомогою `adb` (uiautomator, input, am).
// Waydroid піднімається сам, коли сесія не запущена або Android завис (`connect`); Viber запускається на початку кожної відправки. Контракт відповіді той самий, що був у
// Linux-помічника: { status: 'ready'|'sent'|'skipped'|'failed', reason, severity: 'env'|'before'|'after', detail }.
// Принцип: усе, що неоднозначне, закінчується без відправки; після натискання «Send» ніщо не повторюється.
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const VIBER_PACKAGE = 'com.viber.voip';
const VIBER_LAUNCH = 'com.viber.voip/.WelcomeActivity';
const MEDIA_PERMISSION = 'android.permission.READ_MEDIA_IMAGES';
// Допоміжна клавіатура, яка вводить будь-який Unicode за командою adb (кирилиця, емодзі, переноси рядків).
const ADB_KEYBOARD_PACKAGE = 'com.android.adbkeyboard';
const ADB_KEYBOARD = `${ADB_KEYBOARD_PACKAGE}/.AdbIME`;
const REMOTE_UI_DUMP = '/sdcard/workos-ui.xml';
const POST_TIMEOUT_MS = 4 * 60 * 1000;
// Фото для відправки лежить у Pictures Android лише на час партії: через 3 хв без відправок воно видаляється.
const IMAGE_PREFIX = 'workos-autopost-';
const IMAGE_KEEP_MS = 3 * 60 * 1000;
// З'єднання з Android і результат перевірки середовища живуть недовго: між чатами партії їх не перевіряємо заново.
const CONNECTION_KEEP_MS = 90 * 1000;
const ENVIRONMENT_KEEP_MS = 2 * 60 * 1000;
let lastPostAt = 0;
// Екран Android поточної відправки: при збої з нього знімається знімок для діагностики (`viber-last-failure.png`).
let currentAndroid = null;
let cachedAndroid = null;
let cachedAt = 0;
let environmentOkAt = 0;
// Крок поточної відправки для runner (тре́й і картка партії на сайті): викликається з будь-якого місця без передачі параметрів.
let emitStep = () => {};
const step = (key, text) => { try { emitStep(key, text); } catch { /* діагностика не має ламати відправку */ } };
// Скільки тривав кожен етап поточної відправки: у відповіді й журналі видно, де саме йде час.
let currentLaps = null;

/** Короткі пояснення для журналу й значка в треї; повні тексти для оператора живуть на сайті. */
export const VIBER_ENV_REASON_TEXT = {
  viber_unsupported_platform: 'Автопост Viber працює лише на Linux',
  adb_missing: 'Не встановлено adb (пакет android-tools)',
  waydroid_missing: 'Не встановлено Waydroid',
  waydroid_not_running: 'Waydroid не запущений',
  waydroid_frozen: 'Контейнер Waydroid заморожений',
  android_unreachable: 'Android у Waydroid недоступний для adb',
  android_unauthorized: 'adb не авторизований в Android',
  waydroid_suspend: 'Увімкнене автозаморожування Waydroid',
  viber_not_installed: 'У Waydroid не встановлений Viber',
  viber_not_activated: 'Viber у Waydroid не активований',
  viber_language: 'Мова Android має бути англійською',
  adbkeyboard_missing: 'У Waydroid не встановлена клавіатура ADBKeyBoard',
};

/** Помилка з кодом причини: severity показує, чи могло щось піти в чат. */
class ViberStop extends Error {
  constructor(reason, severity, detail = '') { super(reason); this.reason = reason; this.severity = severity; this.detail = detail; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(file, args, { timeout = 30_000, buffer = false, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout, maxBuffer: 64 << 20, encoding: buffer ? 'buffer' : 'utf8', killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr: String(stderr || ''), error });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Аргумент для `adb shell`: одинарні лапки зберігають кирилицю, емодзі й переноси рядків. */
const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function decodeXml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Дерево доступності без залежностей: кожен `<node …>` стає плоским записом. */
export function parseUiDump(xml) {
  const nodes = [];
  for (const part of String(xml).split('<node ').slice(1)) {
    const head = part.slice(0, part.indexOf('>') + 1 || part.length);
    const attrs = {};
    // Серіалізатор uiautomator бере одинарні лапки, коли значення містить подвійні.
    for (const match of head.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
    const box = (attrs.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!box) continue;
    const [left, top, right, bottom] = box.slice(1).map(Number);
    nodes.push({
      text: attrs.text || '', desc: attrs['content-desc'] || '', id: (attrs['resource-id'] || '').split('/').pop(),
      cls: (attrs.class || '').split('.').pop(), click: attrs.clickable === 'true', checked: attrs.checked === 'true',
      left, top, right, bottom, x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2),
    });
  }
  return nodes;
}

/**
 * Порівняння назв без регістру, емодзі й розділових знаків: Viber і Work OS можуть відрізнятися дрібницями. У Work OS до
 * назви чату часто дописано платформу в кінці («… в Viber», «… у Viber», «(Viber)»), у самому Viber її немає, тож такий
 * хвіст відкидається (лише в кінці й лише слово Viber, саму назву не чіпаємо).
 */
export const looseName = (value) => String(value || '').normalize('NFC')
  .replace(/[\s\-–—([]*(?:(?<![\p{L}\p{N}])(?:в|у|in|на|для|for)\s+)?(?<![\p{L}\p{N}])viber[)\]]*\s*$/iu, '')
  .toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Дешеве читання екрана: `dumpsys activity top` (≈60 мс проти ≈2,2 с у `uiautomator dump`) віддає ієрархію вікна Viber з id
 * і координатами, але без тексту. Координати вузла = початок вікна (`mBounds`) + зсуви всіх батьків; видимість успадковується.
 * Тексти (назва чату, підпис, останнє повідомлення) читає лише повний `uiautomator dump` у точках перевірки.
 */
const VIEW_LINE = /^(\s+)[\w.$]+\{[0-9a-f]+ (\S+) (\S+) (-?\d+),(-?\d+)-(-?\d+),(-?\d+)(?: #[0-9a-f]+ app:id\/(\w+))?\}/;

export function parseViewTree(text, packageName = VIBER_PACKAGE) {
  let activity = '';
  let mine = false;
  let inTree = false;
  let origin = null;
  let views = [];
  let stack = [];
  for (const line of String(text).split('\n')) {
    const header = line.match(/^(?:TASK |  ACTIVITY (\S+))/);
    if (header) {
      if (mine && views.length) break;
      mine = Boolean(header[1] && header[1].startsWith(`${packageName}/`));
      inTree = false; origin = null; views = []; stack = [];
      activity = mine ? header[1] : activity;
      continue;
    }
    if (!mine) continue;
    if (!inTree) {
      const bounds = !origin && line.match(/mBounds=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/);
      if (bounds) origin = { x: Number(bounds[1]), y: Number(bounds[2]), right: Number(bounds[3]), bottom: Number(bounds[4]) };
      if (/^ {4}View Hierarchy:/.test(line)) inTree = true;
      continue;
    }
    const match = line.match(VIEW_LINE);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1] || { x: origin?.x ?? 0, y: origin?.y ?? 0, visible: true };
    const [, , flags, state, l, t, r, b, id] = match;
    const left = parent.x + Number(l); const top = parent.y + Number(t);
    const right = parent.x + Number(r); const bottom = parent.y + Number(b);
    const visible = parent.visible && flags[0] === 'V';
    stack.push({ indent, x: left, y: top, visible });
    if (!id) continue;
    // Точка дотику не виходить за вікно: частково прокручений вузол дотикаємо там, де він видимий.
    const clipLeft = Math.max(left, origin?.x ?? left); const clipTop = Math.max(top, origin?.y ?? top);
    const clipRight = Math.min(right, origin?.right ?? right); const clipBottom = Math.min(bottom, origin?.bottom ?? bottom);
    views.push({ id, left, top, right, bottom, x: Math.round((clipLeft + clipRight) / 2), y: Math.round((clipTop + clipBottom) / 2), visible, click: flags[6] === 'C', focused: state[1] === 'F' });
  }
  return { activity: mine || views.length ? activity : '', views };
}

/** Видимий вузол дешевого дерева за id; `extra` уточнює вибір, коли той самий id зустрічається двічі. */
const viewById = (view, id, extra = () => true) => view.views.find((item) => item.id === id && item.visible && item.right > item.left && item.bottom > item.top && extra(item));

// ---------------------------------------------------------------- Waydroid і adb

async function waydroidState() {
  const result = await run('waydroid', ['status'], { timeout: 10_000 });
  if (result.error && result.error.code === 'ENOENT') throw new ViberStop('waydroid_missing', 'env');
  const field = (name) => (String(result.stdout).match(new RegExp(`^${name}:\\s*(.+)$`, 'mi')) || [])[1]?.trim() || '';
  return { session: field('Session'), container: field('Container'), ip: field('IP address') };
}

class Android {
  constructor(serial) { this.serial = serial; }

  async adb(args, options) { return run('adb', ['-s', this.serial, ...args], options); }
  async sh(command, options) { return (await this.adb(['shell', command], options)).stdout; }

  /** uiautomator відмовляється знімати дерево, поки екран анімується (прокрутка): тоді коротко чекаємо й пробуємо знову. */
  async dump() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const out = await this.sh(`rm -f ${REMOTE_UI_DUMP}; uiautomator dump ${REMOTE_UI_DUMP} >/dev/null 2>&1; cat ${REMOTE_UI_DUMP}`, { timeout: 25_000 });
      const nodes = parseUiDump(out);
      if (nodes.length) return nodes;
      await sleep(500);
    }
    return [];
  }

  /** Дерево вікна Viber без текстів (див. `parseViewTree`). */
  async view() { return parseViewTree(await this.sh('dumpsys activity top', { timeout: 10_000 })); }

  /** Опитує дешеве дерево, поки предикат не поверне щось істинне; повертає { view, hit } або null. */
  async until(predicate, { timeout = 10_000, step = 200 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      const view = await this.view();
      const hit = predicate(view);
      if (hit) return { view, hit };
      if (Date.now() >= end) return null;
      await sleep(step);
    }
  }

  /** Екранна клавіатура на екрані: стискає стрічку розмови, і нове повідомлення не видно в dump. */
  async keyboardShown() { return /mInputShown=true/.test(await this.sh('dumpsys input_method | grep -m1 mInputShown')); }

  tap(node) { return this.sh(`input tap ${node.x} ${node.y}`); }
  key(code) { return this.sh(`input keyevent ${code}`); }
  /** Довший дотик: перший короткий інколи губиться, поки екран ще оновлюється. */
  press(node) { return this.sh(`input swipe ${node.x} ${node.y} ${node.x} ${node.y} 150`); }
  async clock() {
    const [hours, minutes] = (await this.sh('date +%H:%M')).trim().split(':').map(Number);
    return { hours, minutes };
  }
}

const WAYDROID_BOOT_MS = 120_000;
const WAYDROID_RESTART_GAP_MS = 5 * 60 * 1000;
let lastWaydroidRestartAt = 0;
let connecting = null;

/** `waydroid session start` живе, поки живе сесія, тому запускається окремим процесом, який не залежить від runner. */
function startWaydroidSession() {
  const child = spawn('waydroid', ['session', 'start'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function waitWaydroidRunning(timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    const state = await waydroidState();
    if (state.session === 'RUNNING' && state.container === 'RUNNING' && state.ip) return state;
    if (Date.now() >= end) return null;
    await sleep(2000);
  }
}

/** Зупиняє (якщо сесія ще є) і запускає сесію Waydroid; повертає її стан, коли контейнер знову RUNNING. */
async function restartWaydroid(stopFirst) {
  lastWaydroidRestartAt = Date.now();
  cachedAndroid = null;
  environmentOkAt = 0;
  if (stopFirst) {
    await run('waydroid', ['session', 'stop'], { timeout: 60_000 });
    await sleep(2000);
  }
  startWaydroidSession();
  return waitWaydroidRunning(WAYDROID_BOOT_MS);
}

/** adb до Android за адресою контейнера; null — Android не відповідає (сесія RUNNING, але гість завис або ще вантажиться). */
async function reachAndroid(state, timeout) {
  const serial = `${state.ip}:5555`;
  const end = Date.now() + timeout;
  for (;;) {
    await run('adb', ['connect', serial], { timeout: 12_000 });
    const devices = await run('adb', ['devices'], { timeout: 8000 });
    const line = String(devices.stdout).split('\n').find((row) => row.startsWith(serial)) || '';
    if (/unauthorized/.test(line)) throw new ViberStop('android_unauthorized', 'env');
    if (/\bdevice\b/.test(line)) {
      const android = new Android(serial);
      const booted = (await android.sh('getprop sys.boot_completed', { timeout: 8000 })).trim();
      if (booted === '1') return android;
    }
    if (Date.now() >= end) return null;
    await sleep(3000);
  }
}

async function connectNow() {
  if ((await run('adb', ['version'], { timeout: 8000 })).error?.code === 'ENOENT') throw new ViberStop('adb_missing', 'env');
  let state = await waydroidState();
  const healthy = (value) => value.session === 'RUNNING' && value.container === 'RUNNING' && value.ip;
  if (!healthy(state)) {
    // Сесії немає (після перезавантаження ПК) або контейнер заморожений: піднімаємо самі, але не частіше за раз на кілька хвилин.
    if (Date.now() - lastWaydroidRestartAt < WAYDROID_RESTART_GAP_MS) throw new ViberStop(state.container === 'FROZEN' ? 'waydroid_frozen' : 'waydroid_not_running', 'env', state.container);
    state = await restartWaydroid(state.session === 'RUNNING' || state.container === 'FROZEN');
    if (!state) throw new ViberStop('waydroid_not_running', 'env', 'не вдалося запустити сесію');
  }
  let android = await reachAndroid(state, lastWaydroidRestartAt && Date.now() - lastWaydroidRestartAt < WAYDROID_BOOT_MS ? 90_000 : 15_000);
  if (!android) {
    // Сесія RUNNING, а Android не відповідає (2026-10-18: «No route to host», ARP не відповідав): один перезапуск сесії.
    if (Date.now() - lastWaydroidRestartAt < WAYDROID_RESTART_GAP_MS) throw new ViberStop('android_unreachable', 'env', 'Android не відповідає');
    state = await restartWaydroid(true);
    if (!state) throw new ViberStop('waydroid_not_running', 'env', 'не вдалося запустити сесію');
    android = await reachAndroid(state, 90_000);
    if (!android) throw new ViberStop('android_unreachable', 'env', 'Android не відповідає після перезапуску');
  }
  cachedAndroid = android;
  cachedAt = Date.now();
  return cachedAndroid;
}

/** Одночасні перевірки (щохвилинний статус і відправка) ділять одне підключення, щоб не запускати Waydroid двічі. */
function connect() {
  connecting ??= connectNow().finally(() => { connecting = null; });
  return connecting;
}

/** Між відправками партії те саме з'єднання живе ≈1,5 хв: достатньо коротко перевірити, що воно відповідає. */
async function connectQuick() {
  if (cachedAndroid && Date.now() - cachedAt < CONNECTION_KEEP_MS) {
    const ping = await cachedAndroid.sh('echo ok', { timeout: 5000 });
    if (ping.trim() === 'ok') { cachedAt = Date.now(); return cachedAndroid; }
  }
  return connect();
}

async function checkEnvironment(android) {
  const installed = await android.sh(`pm path ${VIBER_PACKAGE}`, { timeout: 15_000 });
  if (!installed.includes('package:')) throw new ViberStop('viber_not_installed', 'env');
  const locale = (await android.sh('getprop persist.sys.locale')).trim() || (await android.sh('getprop ro.product.locale')).trim() || 'en-US';
  if (!/^en/i.test(locale)) throw new ViberStop('viber_language', 'env', locale);
  const keyboard = await android.sh(`pm path ${ADB_KEYBOARD_PACKAGE}`, { timeout: 15_000 });
  if (!keyboard.includes('package:')) throw new ViberStop('adbkeyboard_missing', 'env');
  // Автозаморожування Waydroid зупиняє відправку при схованому вікні: вимикаємо саме, а якщо не вийшло, пояснюємо на сайті.
  if ((await android.sh('getprop persist.waydroid.suspend')).trim() === 'true') {
    await android.sh('setprop persist.waydroid.suspend false');
    if ((await android.sh('getprop persist.waydroid.suspend')).trim() === 'true') throw new ViberStop('waydroid_suspend', 'env');
  }
  // Дозвіл на фото видається тут, а не під час відправки: Viber уже запущений, і видача не має його зачіпати.
  await android.sh(`pm grant ${VIBER_PACKAGE} ${MEDIA_PERMISSION}`);
  environmentOkAt = Date.now();
}

async function ensureEnvironment(android) {
  if (Date.now() - environmentOkAt < ENVIRONMENT_KEEP_MS) return;
  await checkEnvironment(android);
}

// ---------------------------------------------------------------- Екрани Viber

const screenText = (nodes) => nodes.map((node) => `${node.text} ${node.desc}`.trim()).filter(Boolean).join(' | ');
const byId = (nodes, id) => nodes.find((node) => node.id === id);

/** Рекламні «підказки» Viber закриваються кнопкою «назад»; будь-який інший діалог зупиняє відправку. */
async function clearPromos(android, nodes) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (/isn.?t responding/i.test(screenText(nodes))) {
      const wait = nodes.find((node) => node.text === 'Wait');
      if (wait) { await android.tap(wait); await sleep(1800); nodes = await android.dump(); continue; }
    }
    const promo = byId(nodes, 'bottom_sheet_title') && byId(nodes, 'touch_outside') && !joinButton(nodes);
    if (!promo) return nodes;
    await android.key(4);
    await sleep(700);
    nodes = await android.dump();
  }
  return nodes;
}

/** Список чатів готовий: у дереві є пошук і хоч один рядок розмови. */
const chatListReady = (view) => Boolean(viewById(view, 'menu_search') && (viewById(view, 'from') || viewById(view, 'subject')));

async function openChatList(android) {
  await android.key(3);
  // CLEAR_TASK: залишок попередньої задачі (відкритий перегляд фото, розмова) не заважає, Viber починає зі списку чатів.
  await android.sh(`am start -f 0x10008000 -n ${VIBER_LAUNCH}`);
  // Дерево ще кілька сотень мс може показувати стару задачу, яку саме закривають.
  await sleep(500);
  const found = await android.until(chatListReady, { timeout: 40_000, step: 250 });
  if (found) return;
  const nodes = await android.dump();
  const text = screenText(nodes);
  if (/phone number|activate|continue|scan|QR|welcome/i.test(text)) throw new ViberStop('viber_not_activated', 'env', text.slice(0, 120));
  throw new ViberStop('blocking_dialog', 'before', text.slice(0, 160));
}

/** Чат відкритий і доступний для запису: у розмові є поле повідомлення. */
const conversationState = (nodes, expected) => {
  // Заголовок розмови лежить у панелі нагорі; такий самий id має й заголовок банера «Need a reminder?» знизу.
  const title = nodes.find((node) => node.id === 'title' && node.top < 260);
  return { title, input: byId(nodes, 'send_text'), matches: Boolean(title) && looseName(title.text) === looseName(expected) };
};

/** Те саме за дешевим деревом: екран розмови з полем повідомлення (назву й текст перевіряє лише повний dump). */
const conversationReady = (view) => Boolean(view.activity.includes('ConversationActivity') && viewById(view, 'send_text') && viewById(view, 'title', (item) => item.top < 260));

function classifyBlockedScreen(text) {
  if (/no longer|does(?:n.?t| not) exist|not exist|invalid|expired|not valid|unavailable/i.test(text)) return 'viber_chat_missing';
  if (/banned|blocked|removed you|can.?t join|not allowed/i.test(text)) return 'viber_banned';
  if (/only admins?|admins? can/i.test(text)) return 'viber_read_only';
  if (/\bjoin\b/i.test(text)) return 'viber_not_joined';
  return '';
}

/** Кнопка вступу на сторінці запрошення («Join Community», «Join», «Join Group»): найнижча з тих, чий текст починається з Join. */
const joinButton = (nodes) => nodes.filter((node) => /^join\b/i.test(node.text.trim()) && node.bottom > node.top).sort((a, b) => b.top - a.top)[0];

/** Список чатів на екрані: пошук і хоч один рядок розмови. */
const looksLikeChatList = (nodes) => Boolean(byId(nodes, 'menu_search') && (byId(nodes, 'from') || byId(nodes, 'subject')));

/**
 * Що показує екран після відкриття інвайту: розмова з полем повідомлення, сторінка вступу з кнопкою «Join…», діалог
 * з відмовою (бан, неактивне посилання, лише адміни) або щось інше. Текст описів спільнот і списку чатів як відмова не
 * читається: у правилах спільнот трапляються слова «not allowed» і «blocked», а в прев'ю чатів будь-які слова.
 */
export function inviteScreen(nodes, expected) {
  const state = conversationState(nodes, expected);
  if (state.title && state.input) return { kind: 'conversation', state };
  const join = joinButton(nodes);
  if (join) return { kind: 'join', join };
  if (looksLikeChatList(nodes)) return { kind: 'list' };
  const reason = classifyBlockedScreen(screenText(nodes));
  if (reason) return { kind: 'blocked', reason };
  return { kind: state.title ? 'no_input' : 'other', state };
}

/** Сторінка вступу належить саме тому чату, який у черзі: назва спільноти збігається, інакше не приєднуємось нікуди. */
const joinPageNamesChat = (nodes, expected) => {
  const wanted = looseName(expected);
  return Boolean(wanted) && nodes.some((node) => node.text && looseName(node.text) === wanted);
};

/**
 * Приєднання до чату зі сторінки запрошення. Результат читається повним dump: розмова з полем повідомлення — вступ
 * вдався; діалог «Unable to join… blocked» — бан; розмова без поля — лише адміни. Кнопка, що не подіяла, натискається
 * ще раз; далі `viber_not_joined`. Нічого не надсилається, тож усі збої тут `before`.
 */
async function joinChat(android, nodes, expected, guard) {
  for (let tap = 0; tap < 2; tap += 1) {
    const button = joinButton(nodes);
    if (!button) break;
    guard();
    await android.press(button);
    const end = Date.now() + 14_000;
    let withoutInput = 0;
    while (Date.now() < end) {
      await sleep(900);
      const candidate = await clearPromos(android, await android.dump());
      const screen = inviteScreen(candidate, expected);
      if (screen.kind === 'conversation') return candidate;
      if (screen.kind === 'blocked') throw new ViberStop(screen.reason, 'before', screenText(candidate).slice(0, 160));
      if (screen.kind === 'no_input') {
        withoutInput += 1;
        if (withoutInput >= 3) throw new ViberStop('viber_read_only', 'before', screenText(candidate).slice(0, 160));
      }
      if (screen.kind === 'join') {
        nodes = candidate;
        // Кнопка ще на місці: вступ іде повільно або дотик загубився; повторний дотик лише через кілька секунд.
        if (Date.now() > end - 8000) break;
      }
    }
  }
  throw new ViberStop('viber_not_joined', 'before', screenText(nodes).slice(0, 160));
}

async function openTarget(android, payload, guard = () => {}) {
  const expected = String(payload.expectedName || '').trim();
  if (!expected) throw new ViberStop('target_name_missing', 'before');
  if (payload.testTarget === 'my_notes') {
    await openChatList(android);
    const row = (await android.dump()).find((node) => node.id === 'from' && node.text === 'My Notes');
    if (!row) throw new ViberStop('target_not_found', 'before', 'My Notes');
    await android.tap(row);
    const opened = await android.until(conversationReady, { timeout: 15_000, step: 250 });
    if (!opened) throw new ViberStop('target_unconfirmed', 'before', 'My Notes');
    return 'My Notes';
  }
  const link = String(payload.url || '').trim();
  if (!/^https:\/\/invite\.viber\.com\//i.test(link)) throw new ViberStop('invalid_viber_link', 'before');
  await openChatList(android);
  await android.sh(`am start -a android.intent.action.VIEW -d ${shQuote(link)} -p ${VIBER_PACKAGE}`);
  // Дешеве дерево показує, що розмова вже на екрані; будь-який інший екран (вступ, заборона, діалог) раз на кілька секунд
  // читається повним dump з текстом, щоб його розпізнати.
  const startedAt = Date.now();
  let lastDump = 0;
  let withoutInput = 0;
  let nodes = null;
  let screen = null;
  while (!screen && Date.now() - startedAt < 30_000) {
    const ready = conversationReady(await android.view());
    if (ready || (Date.now() - startedAt > 3000 && Date.now() - lastDump > 4000)) {
      // Рекламна підказка поверх розмови ховає її з dump: спершу закриваємо, потім оцінюємо екран.
      const candidate = await clearPromos(android, await android.dump());
      lastDump = Date.now();
      const found = inviteScreen(candidate, expected);
      if (found.kind === 'conversation' || found.kind === 'join' || found.kind === 'blocked') { nodes = candidate; screen = found; }
      else if (found.kind === 'no_input') {
        // Розмова без поля повідомлення: або ще вантажиться, або писати можуть лише адміни.
        withoutInput += 1;
        if (withoutInput >= 2) throw new ViberStop('viber_read_only', 'before', screenText(candidate).slice(0, 160));
      }
    }
    if (!screen) await sleep(250);
  }
  if (!screen) throw new ViberStop('blocking_dialog', 'before', screenText(await android.dump()).slice(0, 160));
  if (screen.kind === 'join') {
    if (!joinPageNamesChat(nodes, expected)) throw new ViberStop('target_unconfirmed', 'before', `join page: ${screenText(nodes).slice(0, 100)}`);
    nodes = await joinChat(android, nodes, expected, guard);
    screen = inviteScreen(nodes, expected);
  }
  if (screen.kind === 'blocked') throw new ViberStop(screen.reason, 'before', screenText(nodes).slice(0, 160));
  const state = conversationState(nodes, expected);
  if (state.title && state.input && state.matches) return state.title.text;
  if (state.title && !state.matches && state.input) throw new ViberStop('target_unconfirmed', 'before', `${state.title.text}`.slice(0, 180));
  throw new ViberStop('blocking_dialog', 'before', screenText(nodes).slice(0, 160));
}

// ---------------------------------------------------------------- Фото

/**
 * Кладе фото в Pictures Android під новою назвою (завжди найновіше в галереї, тож у панелі чату воно перше) і
 * прибирає попередні копії. Файл лишається на час партії й видаляється, коли відправок немає 3 хв.
 * Працює паралельно з відкриттям чату: Viber у цей час не чіпає галерею.
 */
async function freshImage(android, media) {
  if (!media?.base64) throw new ViberStop('image_missing', 'before');
  const name = `${IMAGE_PREFIX}${String(media.sha256 || '').slice(0, 12) || 'image'}-${Date.now().toString(36)}.jpg`;
  const dir = await mkdtemp(join(tmpdir(), 'workos-viber-'));
  try {
    const local = join(dir, name);
    await writeFile(local, Buffer.from(media.base64, 'base64'));
    await removeImages(android);
    const pushed = await android.adb(['push', local, `/sdcard/Pictures/${name}`], { timeout: 60_000 });
    if (pushed.code !== 0) throw new ViberStop('android_error', 'before', 'push');
  } finally { await rm(dir, { recursive: true, force: true }); }
  await android.sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/${name} >/dev/null 2>&1`);
  let indexed = false;
  for (let attempt = 0; attempt < 10 && !indexed; attempt += 1) {
    if (attempt) await sleep(300);
    indexed = (await android.sh(`content query --uri content://media/external/images/media --where ${shQuote(`_display_name='${name}'`)} --projection _id`, { timeout: 20_000 })).includes('_id=');
  }
  if (!indexed) throw new ViberStop('android_error', 'before', 'media index');
  return name;
}

/** Прибирає фото автопосту з Pictures і з MediaStore (галерея не накопичує їх). */
async function removeImages(android) {
  await android.sh(`rm -f /sdcard/Pictures/${IMAGE_PREFIX}*`);
  await android.sh(`content delete --uri content://media/external/images/media --where ${shQuote(`_display_name LIKE '${IMAGE_PREFIX}%'`)}`, { timeout: 20_000 });
}

async function cleanupIdleImages(android) {
  if (Date.now() - lastPostAt < IMAGE_KEEP_MS) return;
  const left = await android.sh(`ls /sdcard/Pictures/${IMAGE_PREFIX}* 2>/dev/null`);
  if (left.includes(IMAGE_PREFIX)) await removeImages(android);
}

// ---------------------------------------------------------------- Відправка

/** Статус повідомлення в Viber лише іконка без підпису; червоний значок означає «не відправлено». */
async function statusLooksFailed(android, node) {
  const shot = await android.adb(['exec-out', 'screencap'], { timeout: 20_000, buffer: true });
  const buf = shot.stdout;
  if (!Buffer.isBuffer(buf) || buf.length < 64) return false;
  const width = buf.readUInt32LE(0); const height = buf.readUInt32LE(4);
  const header = buf.length - width * height * 4;
  if (header < 12 || header > 64) return false;
  let red = 0;
  for (let y = Math.max(0, node.top); y < Math.min(height, node.bottom); y += 1) {
    for (let x = Math.max(0, node.left); x < Math.min(width, node.right); x += 1) {
      const at = header + (y * width + x) * 4;
      if (buf[at] > 170 && buf[at + 1] < 100 && buf[at + 2] < 100) red += 1;
    }
  }
  return red >= 8;
}

// Повідомлення могло зʼявитись у стрічці з запізненням (завантаження фото), тож його мітка часу може бути на пару хвилин давнішою.
const minuteLabels = ({ hours, minutes }) => [0, 1, 2].map((back) => {
  const total = (hours * 60 + minutes - back + 1440) % 1440;
  const h = Math.floor(total / 60); const m = total % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
});

const CAPTION_FIELD = 'custom_cam_preview_media_description';

/**
 * Клавіатура ADB вмикається заздалегідь (на початку відправки): їй потрібно кілька секунд, щоб підхопити поле вводу, а
 * дотик у поле одразу після `ime set` губить першу команду. Стару клавіатуру повертає `ime.restore()` після відправки: якщо
 * повернути її раніше, велика екранна клавіатура вискакує, закриває кнопку «Send», а дотики потрапляють у її клавіші.
 */
async function prepareIme(android, caption) {
  const state = { previous: '', async restore() {} };
  if (!caption.trim()) return state;
  const current = (await android.sh('settings get secure default_input_method')).trim();
  if (current && current !== 'null') state.previous = current;
  // Лишилась клавіатура ADB від перерваної відправки: повертаємо першу іншу зі списку, а не залишаємо її назавжди.
  if (state.previous === ADB_KEYBOARD) {
    state.previous = (await android.sh('ime list -s')).split('\n').map((line) => line.trim()).find((line) => line && line !== ADB_KEYBOARD) || '';
  }
  let restored = false;
  state.restore = async () => {
    if (restored) return;
    restored = true;
    if (state.previous) await android.sh(`ime set ${state.previous}`);
  };
  if (current !== ADB_KEYBOARD) await android.sh(`ime set ${ADB_KEYBOARD}`);
  return state;
}

/** Текст у поле підпису через клавіатуру ADB (див. `prepareIme`). */
async function typeCaption(android, caption, guard) {
  // Якщо клавіатуру хтось підмінив, повертаємо ADB і даємо їй час.
  if ((await android.sh('settings get secure default_input_method')).trim() !== ADB_KEYBOARD) {
    await android.sh(`ime set ${ADB_KEYBOARD}`);
    await sleep(2500);
  }
  // Порожнє поле віддає в дереві підказку «Add a description…»: так відрізняємо «нічого не набралось» від неповного набору.
  const isEmpty = (text) => !text || /^Add a description/i.test(text);
  const base64 = Buffer.from(caption, 'utf8').toString('base64');
  let typed = '';
  for (let attempt = 0; attempt < 2 && typed !== caption; attempt += 1) {
    // Перший дотик у поле, поки перегляд ще встановлюється, ігнорується; коли дотик подіяв, поле або у фокусі, або зникає
    // з дерева (Viber підміняє його полем редагування). Інакше дотикаємо знову. Команда без фокусу мовчки губиться.
    let touched = false;
    for (let touch = 0; touch < 4 && !touched; touch += 1) {
      const field = viewById(await android.view(), CAPTION_FIELD);
      if (!field && !touch) throw new ViberStop('send_ui_unavailable', 'before', 'caption field');
      if (field && !field.focused) {
        guard();
        await android.tap(field);
        await sleep(700);
      }
      const after = viewById(await android.view(), CAPTION_FIELD);
      touched = !after || after.focused;
    }
    if (!touched) throw new ViberStop('send_ui_unavailable', 'before', 'caption focus');
    await sleep(400);
    await android.sh(`am broadcast -a ADB_INPUT_B64 --es msg ${base64}`);
    for (let poll = 0; poll < 2 && typed !== caption; poll += 1) {
      await sleep(poll === 0 ? 200 : 700);
      typed = byId(await android.dump(), CAPTION_FIELD)?.text || '';
      if (typed !== caption && !isEmpty(typed)) break;
    }
    // Повторюємо лише коли поле лишилось порожнім; частковий набір не дописуємо вдруге.
    if (typed !== caption && !isEmpty(typed)) throw new ViberStop('send_ui_unavailable', 'before', 'caption text mismatch');
  }
  if (typed !== caption) throw new ViberStop('send_ui_unavailable', 'before', 'caption not typed');
}

/**
 * Дотик по вузлу з очікуванням наступного екрана за дешевим деревом. Загублений дотик повторюється лише коли екран не
 * змінився; перед повтором перевіряється, чи не закрив його рекламний діалог, якого в дереві активності немає.
 */
async function pressUntil(android, locate, done, { attempts = 3, timeout = 5000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const view = await android.view();
    if (done(view)) return view;
    const target = locate(view);
    if (target) await android.press(target);
    const hit = await android.until(done, { timeout, step: 200 });
    if (hit) return hit.view;
    if (attempt < attempts - 1) await clearPromos(android, await android.dump());
  }
  return null;
}

/**
 * Публікація прямо у відкритому чаті: «+» біля поля повідомлення → «Gallery» (екран «All Media») → найновіше фото (воно
 * лише-но покладене) → попередній перегляд → підпис → «Send». Інлайн-панель галереї під полем (іконка в полі) часто валить
 * Viber у Waydroid, тому не використовується; усі екрани цього шляху `uiautomator dump` витримують.
 */
async function attachAndSend(android, caption, guard, ime) {
  const convo = await android.until(conversationReady, { timeout: 15_000, step: 250 });
  if (!convo) throw new ViberStop('send_ui_unavailable', 'before', 'plus button');
  step('photo', 'додаю фото');
  guard();
  const plusButton = (view) => viewById(view, 'options_menu_open_more');
  const galleryItem = (view) => viewById(view, 'options_more_menu_gallery');
  const menu = await pressUntil(android, plusButton, galleryItem);
  if (!menu) throw new ViberStop('send_ui_unavailable', 'before', 'plus menu');
  currentLaps?.lap('меню');
  guard();
  const firstTile = (view) => {
    const list = viewById(view, 'recent_media_list');
    return list ? view.views.filter((item) => item.id === 'image' && item.visible && item.left >= list.left && item.right <= list.right && item.top >= list.top && item.bottom <= list.bottom).sort((x, y) => x.top - y.top || x.left - y.left)[0] : undefined;
  };
  const gallery = await pressUntil(android, galleryItem, (view) => (firstTile(view) ? view : null), { timeout: 7000 });
  if (!gallery) throw new ViberStop('send_ui_unavailable', 'before', 'gallery');
  currentLaps?.lap('галерея');
  guard();
  // У груповому чаті дотик по плитці лише ВИБИРАЄ фото (з'являється нижня панель з «Edit» і кнопкою відправки), а в «Мої
  // нотатки» одразу відкривається перегляд. Повторний дотик по вибраній плитці знімає вибір, тож по вибраному не тиснемо.
  const previewReady = (view) => (view.activity.includes('MediaPreviewActivity') && viewById(view, 'btn_send') && viewById(view, CAPTION_FIELD) ? view : null);
  const editBar = (view) => viewById(view, 'galleryBottomBarEditGroup');
  const afterTile = await pressUntil(android, (view) => (editBar(view) ? undefined : firstTile(view)), (view) => previewReady(view) || editBar(view), { timeout: 7000 });
  if (!afterTile) throw new ViberStop('send_ui_unavailable', 'before', 'gallery selection');
  let opened = previewReady(afterTile);
  if (!opened) {
    // Вибрана рівно одна плитка: лічильник читається повним dump, бо в дереві без тексту його не видно.
    const count = byId(await android.dump(), 'badge_selected_media');
    if (count && count.text.trim() !== '1') throw new ViberStop('send_ui_unavailable', 'before', 'selected count');
    guard();
    opened = await pressUntil(android, editBar, previewReady, { timeout: 7000 });
  }
  if (!opened) throw new ViberStop('send_ui_unavailable', 'before', 'preview');
  currentLaps?.lap('перегляд');
  try {
    step('text', 'вводжу текст');
    if (caption.trim()) await typeCaption(android, caption, guard);
    currentLaps?.lap('підпис');
    // Остання точка, де «Зупинити» ще діє: далі повідомлення може піти. Повторний дотик лише якщо вікно перегляду
    // не закрилось за 8 с: так надіслане повідомлення не задвоїться, а загублений дотик не залишить чат без відправки.
    // Підпис щойно звірений повним dump у typeCaption, тож між набором і дотиком проходить лише кілька сотень мс.
    step('send', 'надсилаю');
    guard();
    const left = (view) => !view.activity.includes('MediaPreviewActivity');
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt += 1) {
      const view = await android.view();
      const send = viewById(view, 'btn_send');
      if (send && !left(view)) await android.press(send);
      sent = Boolean(await android.until(left, { timeout: 8000, step: 250 }));
    }
    if (!sent) throw new ViberStop('send_not_confirmed', 'after', 'send button did not respond');
  } finally {
    await ime.restore();
  }
}

/** Повідомлення з підписом серед усіх текстових вузлів стрічки: у жвавому чаті чужі повідомлення вже лежать нижче за наше. */
function findOwnMessage(nodes, prefix) {
  const texts = nodes.filter((node) => node.id === 'textMessageView').sort((a, b) => b.bottom - a.bottom);
  if (!prefix) return texts[0] ?? null;
  return texts.find((node) => looseName(node.text).startsWith(prefix)) ?? null;
}

const stampOf = (nodes, message) => {
  const stamp = message && nodes.filter((node) => node.id === 'timestampView' && node.top >= message.top - 10).sort((a, b) => a.top - b.top)[0];
  return stamp ? stamp.text.replace(/[\s\u00a0\u202f]+/g, ' ').trim() : '';
};

async function confirmSent(android, caption, targetName) {
  step('confirm', 'перевіряю, що повідомлення в чаті');
  const conversation = await android.until(conversationReady, { timeout: 25_000, step: 250 });
  if (!conversation) throw new ViberStop('send_not_confirmed', 'after', 'conversation not shown');
  const prefix = looseName(caption).slice(0, 24);
  // Повідомлення з'являється в стрічці не миттєво (Viber спершу обробляє фото): читаємо повним dump, поки воно не зʼявиться, до 40 с.
  // Після «Send» іншої безпечної дії немає, а хибне «не підтверджено» віддало б власнику вже надісланий чат. Своє повідомлення шукаємо
  // серед усіх видимих: у великому чаті воно швидко опиняється вище за чужі, тож стрічку то підсуваємо донизу, то гортаємо вгору.
  let nodes = [];
  let mine = null;
  let stampText = '';
  let labels = [];
  const deadline = Date.now() + 40_000;
  for (let attempt = 0; attempt === 0 || Date.now() < deadline; attempt += 1) {
    if (attempt) await sleep(1000);
    // Після відправки меню «+» іноді лишається відкритим, а повернена стара клавіатура інколи вискакує: обоє стискають
    // стрічку, і нове повідомлення не видно в dump. «Назад» закриває клавіатуру, поки вона на екрані (розмову не покидає).
    if (await android.keyboardShown()) { await android.key(4); await sleep(600); }
    const view = await android.view();
    const plus = viewById(view, 'options_menu_open_more');
    if (plus && viewById(view, 'options_more_menu_gallery')) {
      await android.press(plus);
      await android.until((next) => !viewById(next, 'options_more_menu_gallery'), { timeout: 2500, step: 200 });
    }
    if (attempt >= 2 && !mine) await android.sh(attempt < 5 ? 'input swipe 850 760 850 380 250' : 'input swipe 850 380 850 760 250');
    labels = minuteLabels(await android.clock());
    nodes = await android.dump();
    const opened = conversationState(nodes, targetName);
    if (!opened.title) continue;
    if (!opened.matches) throw new ViberStop('target_unconfirmed', 'after', opened.title.text.slice(0, 80));
    mine = findOwnMessage(nodes, prefix);
    stampText = stampOf(nodes, mine);
    if (mine && labels.includes(stampText)) break;
    mine = null;
  }
  if (!mine) throw new ViberStop('send_not_confirmed', 'after', 'new message not found');
  const status = nodes.find((node) => node.id === 'statusView' && node.top >= mine.top - 10 && node.top <= mine.bottom + 40);
  if (status && await statusLooksFailed(android, status)) throw new ViberStop('send_not_confirmed', 'after', 'message marked as not sent');
}

/**
 * Дія «Перевірити»: відкриває чат і лише дивиться, чи є в ньому повідомлення з цим підписом, надісланe приблизно тоді, коли
 * відправка закінчилась невизначено. Нічого не надсилає. Мітка часу має збігатися з хвилинами навколо моменту відправки,
 * тож учорашнє оголошення з тим самим текстом не зараховується.
 */
async function verify(payload, guard) {
  guard();
  step('env', 'перевіряю Waydroid і Viber');
  const android = await connectQuick();
  currentAndroid = android;
  await ensureEnvironment(android);
  guard();
  step('open', 'відкриваю чат');
  const targetName = await openTarget(android, payload, guard);
  step('confirm', 'шукаю повідомлення в чаті');
  const caption = String(payload.message || '');
  const prefix = looseName(caption).slice(0, 24);
  if (!prefix) throw new ViberStop('message_not_found', 'before', 'empty caption');
  // Момент відправки невідомий (давня перевірка без нього): мітку часу не звіряємо, шукаємо лише за підписом.
  const sinceEpoch = Number(payload.sinceEpoch) || 0;
  const ageMinutes = sinceEpoch ? Math.max(0, Math.round((Date.now() / 1000 - sinceEpoch) / 60)) : 0;
  if (ageMinutes > 600) throw new ViberStop('message_not_found', 'before', 'sent too long ago');
  const { hours, minutes } = await android.clock();
  const center = hours * 60 + minutes - ageMinutes;
  const labels = [-4, -3, -2, -1, 0, 1, 2].map((shift) => {
    const total = (center + shift + 1440) % 1440;
    const h = Math.floor(total / 60); const m = total % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    guard();
    if (attempt === 1) await android.sh('input swipe 850 380 850 760 250');
    else if (attempt > 1) await android.sh('input swipe 850 380 850 760 250');
    const nodes = await android.dump();
    const opened = conversationState(nodes, targetName);
    if (!opened.title) continue;
    if (!opened.matches) throw new ViberStop('target_unconfirmed', 'before', opened.title.text.slice(0, 80));
    const mine = findOwnMessage(nodes, prefix);
    if (mine && (!sinceEpoch || labels.includes(stampOf(nodes, mine)))) return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: targetName, timings: `перевірено, спроб ${attempt + 1}` };
  }
  throw new ViberStop('message_not_found', 'before', 'message not in chat');
}

// ---------------------------------------------------------------- Дії для runner

async function status() {
  const android = await connect();
  await checkEnvironment(android);
  await cleanupIdleImages(android);
  return { ok: true, status: 'ready', reason: null, severity: 'env', detail: '' };
}

/** Секундомір етапів: `lap('назва')` записує, скільки минуло від попередньої позначки. */
function startLaps() {
  const laps = { items: [], mark: Date.now(), started: Date.now() };
  laps.lap = (name) => { const now = Date.now(); laps.items.push(`${name} ${((now - laps.mark) / 1000).toFixed(1)}`); laps.mark = now; };
  laps.text = () => `${laps.items.join(', ')}, разом ${((Date.now() - laps.started) / 1000).toFixed(1)} с`;
  return laps;
}

async function post(payload, guard) {
  guard();
  lastPostAt = Date.now();
  const laps = startLaps();
  currentLaps = laps;
  step('env', 'перевіряю Waydroid і Viber');
  const android = await connectQuick();
  currentAndroid = android;
  await ensureEnvironment(android);
  laps.lap('adb');
  guard();
  const caption = String(payload.message || '');
  const ime = await prepareIme(android, caption);
  try {
    // Фото кладеться паралельно з відкриттям чату: до галереї воно вже буде в індексі.
    const image = freshImage(android, payload.media);
    image.catch(() => {});
    step('open', 'відкриваю чат');
    const targetName = await openTarget(android, payload, guard);
    laps.lap('чат');
    guard();
    await image;
    laps.lap('фото');
    guard();
    await attachAndSend(android, caption, guard, ime);
    laps.lap('відправка');
    await confirmSent(android, caption, targetName);
    laps.lap('підтвердження');
    lastPostAt = Date.now();
    return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: targetName, timings: laps.text() };
  } finally {
    await ime.restore();
  }
}

/**
 * @param {'status'|'post'|'verify'} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{ok:boolean,status:string,reason?:string|null,severity?:string,detail?:string,[key:string]:unknown}>}
 */
export async function runViberAndroid(action, payload = {}, { shouldAbort = () => false, onStep = () => {} } = {}) {
  if (process.platform !== 'linux') return { ok: true, status: 'skipped', reason: 'viber_unsupported_platform', severity: 'env' };
  let timer;
  try {
    // Скасування оператором («Зупинити») діє до відправки: після нього жодного нового кроку.
    const guard = () => { if (shouldAbort()) throw new ViberStop('cancelled', 'before'); };
    currentLaps = null;
    emitStep = onStep;
    const work = action === 'status' ? status() : action === 'verify' ? verify(payload, guard) : post(payload, guard);
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new ViberStop('helper_timeout', 'after', 'timeout')), POST_TIMEOUT_MS); });
    return await Promise.race([work, limit]);
  } catch (error) {
    if (error instanceof ViberStop && error.severity !== 'env' && error.reason !== 'cancelled' && currentAndroid) {
      // Що було на екрані в момент збою: текст у деталі журналу й знімок поруч із журналом runner.
      try {
        const nodes = await currentAndroid.dump();
        error.detail = `${error.detail} | screen: ${screenText(nodes).slice(0, 160)}${currentLaps ? ` | ${currentLaps.text()}` : ''}`.trim();
        const shot = await currentAndroid.adb(['exec-out', 'screencap', '-p'], { timeout: 20_000, buffer: true });
        const dir = join(homedir(), '.local', 'state', 'work-os');
        await mkdir(dir, { recursive: true });
        if (Buffer.isBuffer(shot.stdout) && shot.stdout.length > 1000) await writeFile(join(dir, 'viber-last-failure.png'), shot.stdout);
      } catch { /* діагностика не має ламати відповідь */ }
    }
    if (error instanceof ViberStop) return { ok: false, status: error.severity === 'env' ? 'blocked' : error.severity === 'after' ? 'failed' : 'skipped', reason: error.reason, severity: error.severity, detail: error.detail };
    return { ok: false, status: 'failed', reason: 'helper_error', severity: 'after', detail: String(error?.message || error).slice(0, 160) };
  } finally { clearTimeout(timer); emitStep = () => {}; }
}

/** Дані завдання черги → вхід адаптера. */
export function viberPayloadFromTask(task, overrides = {}) {
  return {
    id: task.jobId,
    url: task.target?.expectedLink || '',
    expectedName: task.target?.expectedName || '',
    message: task.material?.text || '',
    media: task.material?.media || null,
    ...overrides,
  };
}
