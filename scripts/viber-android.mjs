// Автопост у Viber через Android у Waydroid: runner керує застосунком Viber за допомогою `adb` (uiautomator, input, am).
// Waydroid піднімається сам, коли сесія не запущена або Android завис (`connect`); Viber запускається на початку кожної відправки. Контракт відповіді той самий, що був у
// Linux-помічника: { status: 'ready'|'sent'|'skipped'|'failed', reason, severity: 'env'|'before'|'after', detail }.
// Принцип: усе, що неоднозначне, закінчується без відправки; після натискання «Send» ніщо не повторюється.
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hideAndroidWindows } from './hyprland-android-windows.mjs';
import { saveFailureSnapshot } from './failure-snapshots.mjs';

const VIBER_PACKAGE = 'com.viber.voip';
const VIBER_LAUNCH = 'com.viber.voip/.WelcomeActivity';
const MEDIA_PERMISSION = 'android.permission.READ_MEDIA_IMAGES';
// Допоміжна клавіатура, яка вводить будь-який Unicode за командою adb (кирилиця, емодзі, переноси рядків).
const ADB_KEYBOARD_PACKAGE = 'com.android.adbkeyboard';
const ADB_KEYBOARD = `${ADB_KEYBOARD_PACKAGE}/.AdbIME`;
const REMOTE_UI_DUMP = '/sdcard/workos-ui.xml';
// Сторожовий тайм-аут на всю задачу й ліміти окремих кроків: жоден крок не висить довше, ніж йому відведено. Тривалий крок обриває
// всі `adb`-процеси задачі (AbortController), тож завислий `uiautomator dump` чи `adb connect` не тримає чергу.
const POST_TIMEOUT_MS = 3 * 60 * 1000;
// Перевірка гортає стрічку й за свіжої відправки чекає до 100 с: їй потрібен ширший сторож.
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000;
const STEP_LIMITS_MS = { env: 150_000, open: 40_000, photo: 30_000, send: 75_000, confirm: 70_000, verify: 150_000 };
// Viber відповідає на початку партії: якщо ні, force-stop і запуск заново.
const PREFLIGHT_KEEP_MS = 3 * 60 * 1000;
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
// Поточна задача: її AbortController (обриває всі `adb`-виклики), назва, крок і чи вже натиснуто «Send» (після цього обрив не діє).
let taskController = null;
let activeTask = null;
let sendPressed = false;
let sendPressedAt = 0;
let preflightOkAt = 0;
const abortTask = (stop) => { if (taskController && !taskController.signal.aborted) taskController.abort(stop); };
/** «Зупинити» від оператора: обриває поточний крок одразу, але лише до натискання «Send». */
export function cancelViberTask() { if (!sendPressed) abortTask(new ViberStop('cancelled', 'before')); }
/** Що робить адаптер зараз (для рядка стану runner): null, якщо вільний. */
export const viberActiveTask = () => (activeTask ? { ...activeTask } : null);
const step = (key, text) => { if (activeTask) activeTask.step = text; try { emitStep(key, text); } catch { /* діагностика не має ламати відправку */ } };
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
  viber_not_responding: 'Viber у Waydroid не відповідає',
  waydroid_suspend: 'Увімкнене автозаморожування Waydroid',
  viber_not_installed: 'У Waydroid не встановлений Viber',
  viber_not_activated: 'Viber у Waydroid не активований',
  viber_language: 'Мова Android має бути англійською',
  adbkeyboard_missing: 'У Waydroid не встановлена клавіатура ADBKeyBoard',
  adbkeyboard_disabled: 'Клавіатура ADBKeyBoard встановлена, але не ввімкнена в Android',
  viber_invite_not_opened: 'Viber не відкриває чати за запрошенням',
};

// Коди, після яких екран був не тим, що чекав адаптер: для них зберігається знімок (скріншот і дерево).
const UNKNOWN_STATE_REASONS = new Set(['viber_unknown_window', 'blocking_dialog', 'send_ui_unavailable', 'send_not_confirmed', 'viber_invite_not_opened', 'target_not_found', 'helper_error', 'adbkeyboard_disabled', 'android_error']);

/** Помилка з кодом причини: severity показує, чи могло щось піти в чат. */
class ViberStop extends Error {
  // `observed` — назва чату, яку показав Viber (для «Не той чат»: власник бачить «У Work OS: X · у Viber: Y» і може оновити назву).
  constructor(reason, severity, detail = '', observed = '') { super(reason); this.reason = reason; this.severity = severity; this.detail = detail; this.observed = observed; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(file, args, { timeout = 30_000, buffer = false, input } = {}) {
  // Виклики поточної задачі підпорядковані її AbortController: обрив убиває дочірній процес і одразу відхиляє промис причиною обриву.
  const signal = taskController?.signal;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout, maxBuffer: 64 << 20, encoding: buffer ? 'buffer' : 'utf8', killSignal: 'SIGKILL', ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr: String(stderr || ''), error });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/**
 * Крок задачі з власним лімітом часу. Не вклався: обриваємо всі `adb`-виклики задачі й віддаємо код `viber_step_timeout`
 * (до «Send» чат не зачеплено, задача піде на повтор), а після «Send» — `send_not_confirmed` (потребує рішення, без повтору).
 */
async function withStep(label, limitMs, fn) {
  const startedAt = Date.now();
  if (activeTask) activeTask.step = label;
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const stop = sendPressed
        ? new ViberStop('send_not_confirmed', 'after', `крок «${label}» не вклався в ${Math.round(limitMs / 1000)} с`)
        : new ViberStop('viber_step_timeout', 'before', `крок «${label}» висів ${Math.round((Date.now() - startedAt) / 1000)} с (ліміт ${Math.round(limitMs / 1000)} с)`);
      abortTask(stop);
      reject(stop);
    }, limitMs);
  });
  // Імітація зависання для перевірки сторожів: WORK_OS_VIBER_STALL=«назва кроку» замінює його довгим процесом, який обрив теж убиває.
  const work = process.env.WORK_OS_VIBER_STALL === label ? run('sleep', ['600'], { timeout: 600_000 }) : fn();
  work.catch(() => {});
  try { return await Promise.race([work, stalled]); } finally { clearTimeout(timer); }
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
  .replace(/[\s\-–—]*[([]\s*чат\s*[)\]]\s*$/iu, '')
  .toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Дешеве читання екрана: `dumpsys activity top` (≈60 мс проти ≈2,2 с у `uiautomator dump`) віддає ієрархію вікна Viber з id
 * і координатами, але без тексту. Координати вузла = початок вікна (`mBounds`) + зсуви всіх батьків; видимість успадковується.
 * Тексти (назва чату, підпис, останнє повідомлення) читає лише повний `uiautomator dump` у точках перевірки.
 */
// Після `uiautomator dump` Android дописує до рядків дерева ` aid=…` (accessibility id), а власні вузли системи мають
// `android:id/…`: обидва варіанти раніше не збігалися з шаблоном, рядок відкидався, і діти вузла рахувались від чужого
// батька (3.17.5: «Send» мав top 0 і visible=false, дотик не йшов, хоча кнопка була на екрані).
const VIEW_LINE = /^(\s+)[\w.$]+\{[0-9a-f]+ (\S+) (\S+) (-?\d+),(-?\d+)-(-?\d+),(-?\d+)(?: #[0-9a-f]+ (?:app|android):id\/(\w+))?[^}\n]*\}/;

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

let singleWindowChecked = false;
/**
 * Android у Waydroid без окремих вікон на робочому столі: `persist.waydroid.multi_windows=false`. Адаптер ніде не показує вікно
 * (`waydroid app launch` і `show-full-ui` не викликаються, Viber запускається лише через `adb shell am start`); якщо прапорець
 * усе ж увімкнений, вимикаємо його раз за життя runner (діє з наступного запуску сесії Waydroid, поточну не перезапускаємо).
 * Під Hyprland вікна ховає правило з hyprland-android-windows.mjs, тому там нічого не змінюємо.
 */
async function ensureSingleWindowMode() {
  if (singleWindowChecked || process.env.HYPRLAND_INSTANCE_SIGNATURE) return;
  singleWindowChecked = true;
  const current = String((await run('waydroid', ['prop', 'get', 'persist.waydroid.multi_windows'], { timeout: 10_000 })).stdout || '').trim();
  if (current === 'true') {
    await run('waydroid', ['prop', 'set', 'persist.waydroid.multi_windows', 'false'], { timeout: 10_000 });
    console.warn('Waydroid: вимкнено multi_windows, щоб вікна Android не з’являлись на робочому столі (діє з наступного запуску сесії).');
  }
}

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

// Дозвіл adb не має залежати від вікна «Allow USB debugging». Android читає ключі з /data/misc/adb/adb_keys, а ця тека Waydroid
// належить користувачеві хоста (~/.local/share/waydroid/data), тож відкритий ключ з ~/.android/adbkey.pub дописується туди без root.
// Перевірено наживо 2026-10-26: новий ключ, дописаний у цей файл з хоста, одразу дає статус `device` без запиту в Android.
const ADB_PUBLIC_KEY = () => join(process.env.ANDROID_USER_HOME || join(homedir(), '.android'), 'adbkey.pub');
const WAYDROID_DATA = () => process.env.WORK_OS_WAYDROID_DATA || join(homedir(), '.local', 'share', 'waydroid', 'data');

/** Дописує ключ adb хоста в adb_keys Waydroid, якщо його там немає. true — файл змінено (потрібне нове підключення). */
export async function ensureAdbKeyAuthorized() {
  let pub = '';
  try { pub = (await readFile(ADB_PUBLIC_KEY(), 'utf8')).trim(); } catch { return false; }
  const token = pub.split(/\s+/)[0];
  if (!token) return false;
  const keyFile = join(WAYDROID_DATA(), 'misc', 'adb', 'adb_keys');
  let current = '';
  try { current = await readFile(keyFile, 'utf8'); } catch { /* файла ще немає: Android створить теку при завантаженні, а ми дозаписуємо */ }
  if (current.split('\n').some((line) => line.trim().split(/\s+/)[0] === token)) return false;
  try {
    await mkdir(dirname(keyFile), { recursive: true });
    await appendFile(keyFile, `${current && !current.endsWith('\n') ? '\n' : ''}${pub}\n`);
    return true;
  } catch { return false; }
}

// Вікно Waydroid автоматично не відкривається (воно забрало б фокус і зірвало б повноекранне відео власника): запит «Allow» чекає, поки власник
// сам натисне «Відкрити вікно» в картці (обробник workos-waydroid://show) або отримає сповіщення.

/** adb до Android за адресою контейнера; null — Android не відповідає (сесія RUNNING, але гість завис або ще вантажиться). */
async function reachAndroid(state, timeout) {
  const serial = `${state.ip}:5555`;
  const end = Date.now() + timeout;
  let keyRetried = false;
  let waitingForAllow = 0;
  for (;;) {
    await run('adb', ['connect', serial], { timeout: 12_000 });
    const devices = await run('adb', ['devices'], { timeout: 8000 });
    const line = String(devices.stdout).split('\n').find((row) => row.startsWith(serial)) || '';
    if (/unauthorized/.test(line)) {
      if (!keyRetried) {
        // Перша спроба: ключ могли втратити (перезавантаження, оновлення Waydroid): дописуємо його й підключаємось заново.
        keyRetried = true;
        if (await ensureAdbKeyAuthorized()) { await run('adb', ['disconnect', serial], { timeout: 8000 }); await sleep(800); continue; }
      }
      // Ключ уже в adb_keys, а Android усе одно питає: чекаємо на «Allow» до хвилини (вікно не відкриваємо), а не крутимо спроби.
      if (!waitingForAllow) { waitingForAllow = Date.now(); step('env', 'потрібно натиснути Allow в Android'); }
      if (Date.now() - waitingForAllow > 60_000) throw new ViberStop('android_unauthorized', 'env', 'ключ записано, Android чекає на Allow');
      await sleep(2000);
      continue;
    }
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
  // Ключ дописуємо заздалегідь, щоб перший же `adb connect` після перезавантаження ПК пройшов без запиту.
  await ensureAdbKeyAuthorized();
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

/** Увімкнені методи введення (`ime list -s`). */
async function enabledImes(android) {
  return (await android.sh('ime list -s', { timeout: 10_000 })).split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Робить клавіатуру ADB поточною: спершу `ime enable` (без нього `ime set` мовчки нічого не змінює), потім `ime set`. */
async function selectAdbKeyboard(android) {
  await android.sh(`ime enable ${ADB_KEYBOARD}`);
  await android.sh(`ime set ${ADB_KEYBOARD}`);
}

async function checkEnvironment(android) {
  const installed = await android.sh(`pm path ${VIBER_PACKAGE}`, { timeout: 15_000 });
  if (!installed.includes('package:')) throw new ViberStop('viber_not_installed', 'env');
  const locale = (await android.sh('getprop persist.sys.locale')).trim() || (await android.sh('getprop ro.product.locale')).trim() || 'en-US';
  if (!/^en/i.test(locale)) throw new ViberStop('viber_language', 'env', locale);
  const keyboard = await android.sh(`pm path ${ADB_KEYBOARD_PACKAGE}`, { timeout: 15_000 });
  if (!keyboard.includes('package:')) throw new ViberStop('adbkeyboard_missing', 'env');
  // Встановлена клавіатура Android не вважає доступною, поки її не ввімкнено (`ime list -s` її не показує, `ime set` мовчки не діє,
  // а підпис потрапляє в екранну клавіатуру). Вмикаємо самі; якщо не вийшло, це окрема причина зі своїм поясненням.
  if (!(await enabledImes(android)).includes(ADB_KEYBOARD)) {
    await android.sh(`ime enable ${ADB_KEYBOARD}`);
    if (!(await enabledImes(android)).includes(ADB_KEYBOARD)) throw new ViberStop('adbkeyboard_disabled', 'env');
  }
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

/**
 * Самовідновлення перед партією: adb уже підключений (connect), тепер Viber має відкрити список чатів. Не відповів: force-stop і
 * запуск заново; не відповів і вдруге — одна пауза черги з пояснювальним кодом, а не потік невдалих спроб по чатах.
 */
async function preflight(android) {
  if (Date.now() - preflightOkAt < PREFLIGHT_KEEP_MS) return;
  step('env', 'перевіряю, що Viber відповідає');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await openChatList(android, 25_000);
      preflightOkAt = Date.now();
      return;
    } catch (error) {
      if (error instanceof ViberStop && (error.reason === 'viber_not_activated' || error.reason === 'cancelled' || error.reason === 'viber_unknown_window')) throw error;
      await android.sh(`am force-stop ${VIBER_PACKAGE}`, { timeout: 10_000 });
      await sleep(1500);
    }
  }
  throw new ViberStop('viber_not_responding', 'env', 'Viber не відкрив список чатів після перезапуску');
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

/**
 * Відомі заставки Viber після запуску, що стоять перед списком чатів (17.11: «Your Notifications are OFF!» тримав Viber на
 * `GlobalNotificationSplashActivity`, і черга стояла годину). Повертає опис дії чи null, якщо екран невідомий. `view` — дешеве дерево
 * (назва активності), `nodes` — повний dump (тексти).
 */
export function knownScreen(nodes, view = { activity: '' }) {
  const text = screenText(nodes);
  if (/GlobalNotificationSplashActivity|notificationsoff/i.test(view.activity || '') || /Your Notifications are OFF|Please do not show me this again/i.test(text)) return { kind: 'notifications_off' };
  if (byId(nodes, 'bottom_sheet_title') && nodes.some((node) => node.id === 'positive_button' && /^got it$/i.test(node.text.trim()))) return { kind: 'got_it' };
  if (/Remix now|Create your own Remix/i.test(text)) return { kind: 'remix' };
  // Заставки з однією безпечною відмовою: тапаємо лише кнопку відмови, «Turn on» / «Allow» / «Enable» не чіпаємо ніколи.
  const decline = nodes.find((node) => (node.click || /Button/i.test(node.cls)) && /^(?:not now|skip|maybe later|no,? thanks|later)$/i.test(node.text.trim()));
  if (decline) return { kind: 'decline', node: decline };
  return null;
}

/** Закриває відому заставку; true — щось було й закрите. «Turn on» (сповіщення Android не потрібні) не натискається. */
async function dismissKnownScreen(android, nodes, view) {
  const known = knownScreen(nodes, view);
  if (!known) return false;
  if (known.kind === 'notifications_off') {
    // «Please do not show me this again» (чекбокс), потім «Назад»: Viber більше не показує заставку.
    const box = nodes.find((node) => node.cls === 'CheckBox') || nodes.find((node) => /Please do not show me this again/i.test(node.text));
    if (box) {
      await android.tap(box);
      await sleep(500);
      const after = await android.dump();
      const checkbox = after.find((node) => node.cls === 'CheckBox');
      if (checkbox && !checkbox.checked) { await android.tap(checkbox); await sleep(400); }
    }
    await android.key(4);
    await sleep(1200);
    return true;
  }
  if (known.kind === 'got_it') { await android.tap(nodes.find((node) => node.id === 'positive_button')); await sleep(900); return true; }
  if (known.kind === 'decline') { await android.tap(known.node); await sleep(900); return true; }
  await android.key(4);
  await sleep(900);
  return true;
}

/** Заголовок невідомого вікна для пояснення в картці: id title/headline, інакше найвищий осмислений текст. */
function windowTitle(nodes) {
  const named = nodes.find((node) => /title|headline|header/i.test(node.id) && node.text.trim());
  const first = named || nodes.filter((node) => node.text.trim().length > 2 && node.top < 700).sort((a, b) => a.top - b.top)[0];
  return (first?.text || screenText(nodes)).replace(/\s+/g, ' ').trim().slice(0, 80) || 'без заголовка';
}

async function snapshotUnknownScreen(android, code, nodes, detail) {
  try {
    const shot = await android.adb(['exec-out', 'screencap', '-p'], { timeout: 15_000, buffer: true });
    const tree = nodes.map((node) => `${node.id}\t${node.cls}\t${JSON.stringify(node.text)}\t${JSON.stringify(node.desc)}\t[${node.left},${node.top}][${node.right},${node.bottom}]`).join('\n');
    saveFailureSnapshot({ platform: 'viber', code, png: Buffer.isBuffer(shot.stdout) ? shot.stdout : null, tree, detail });
  } catch { /* знімок необов'язковий */ }
}

async function openChatList(android, timeout = 40_000) {
  await android.key(3);
  // CLEAR_TASK: залишок попередньої задачі (відкритий перегляд фото, розмова) не заважає, Viber починає зі списку чатів.
  await android.sh(`am start -f 0x10008000 -n ${VIBER_LAUNCH}`);
  // Дерево ще кілька сотень мс може показувати стару задачу, яку саме закривають.
  await sleep(500);
  const end = Date.now() + timeout;
  let found = await android.until(chatListReady, { timeout: Math.min(timeout, 9000), step: 250 });
  // Список не з'явився: знайома заставка (сповіщення вимкнені, «Got it», «Not now») закривається, і чекаємо список далі.
  for (let attempt = 0; !found && attempt < 5; attempt += 1) {
    const nodes = await android.dump();
    if (/phone number|activate|continue|scan|QR|welcome/i.test(screenText(nodes)) && !knownScreen(nodes)) break;
    if (!await dismissKnownScreen(android, nodes, await android.view())) break;
    found = await android.until(chatListReady, { timeout: Math.min(6000, Math.max(1000, end - Date.now())), step: 250 });
  }
  if (!found && Date.now() < end) found = await android.until(chatListReady, { timeout: end - Date.now(), step: 250 });
  if (found) return;
  const nodes = await android.dump();
  const text = screenText(nodes);
  if (/phone number|activate|continue|scan|QR|welcome/i.test(text)) throw new ViberStop('viber_not_activated', 'env', text.slice(0, 120));
  // Невідома заставка чи діалог після запуску: власник бачить у картці, що саме заважає (заголовок вікна), а не «Viber не відповідає».
  const view = await android.view().catch(() => ({ activity: '' }));
  const detail = `Viber показує невідоме вікно після запуску: ${windowTitle(nodes)}${view.activity ? ` (${view.activity.split('/').pop()})` : ''}`;
  await snapshotUnknownScreen(android, 'viber_unknown_window', nodes, detail);
  throw new ViberStop('viber_unknown_window', 'env', detail);
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

// Підписи панелі й кнопок сторінки вступу, які не є назвою спільноти.
const JOIN_PAGE_NOISE = /^(?:join\b|navigate up|more options|share|back)/iu;
// «2,654 members», «1.2K members», «15 учасників»: рядок під назвою спільноти.
const MEMBERS_LINE = /^\d[\d\s.,]*[km]?\s*(?:members?|учасник\p{L}*|участник\p{L}*|subscribers?|followers?)(?!\p{L})/iu;

/**
 * Назва спільноти зі сторінки вступу (сторінка може показувати інший чат за тим самим запрошенням): останній непорожній рядок між «Navigate up» і
 * «N members». Без рядка з учасниками — перший текст після «Navigate up». Порожньо, якщо назви не видно.
 */
export function joinPageTitle(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const texts = list.map((node) => String(node.text || '').trim());
  const up = list.findIndex((node) => /^navigate up$/iu.test(String(node.desc || node.text || '').trim()));
  const from = up >= 0 ? up + 1 : 0;
  const members = texts.findIndex((text, index) => index >= from && MEMBERS_LINE.test(text));
  if (members >= 0) {
    for (let index = members - 1; index >= from; index -= 1) if (texts[index] && !JOIN_PAGE_NOISE.test(texts[index])) return texts[index].slice(0, 180);
    return '';
  }
  if (up < 0) return '';
  for (let index = from; index < texts.length; index += 1) if (texts[index] && !JOIN_PAGE_NOISE.test(texts[index])) return texts[index].slice(0, 180);
  return '';
}

/** Сторінка вступу належить саме тому чату, який у черзі: назва спільноти збігається, інакше не приєднуємось нікуди. */
export const joinPageNamesChat = (nodes, expected) => {
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

/**
 * Уже приєднаний чат зі списку Viber: рядок із точно такою назвою (без регістру й емодзі), єдиний на екрані й у трьох прокрутках.
 * Дві однакові назви чи жодної — нічого не відкриваємо. Повертає дерево відкритої розмови або null; назву розмови перевіряє виклик.
 */
async function openFromChatList(android, expected, firstNodes) {
  const wanted = looseName(expected);
  if (!wanted) return null;
  let nodes = firstNodes;
  for (let round = 0; round < 4; round += 1) {
    const rows = nodes.filter((node) => node.id === 'from' && looseName(node.text) === wanted);
    if (rows.length > 1) return null;
    if (rows.length === 1) {
      await android.tap(rows[0]);
      const opened = await android.until(conversationReady, { timeout: 12_000, step: 250 });
      if (!opened) return null;
      const dump = await clearPromos(android, await android.dump());
      return conversationState(dump, expected).matches ? dump : null;
    }
    const list = nodes.find((node) => node.id === 'from');
    if (!list) return null;
    await android.sh(`input swipe ${list.x} ${Math.round(list.top + 500)} ${list.x} ${Math.max(0, Math.round(list.top - 300))} 300`);
    await sleep(700);
    nodes = await android.dump();
  }
  return null;
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
  // Лише для перевірок: імітація збою відкриття запрошення (запобіжник серії), нічого не чіпає в Android.
  if (process.env.WORK_OS_VIBER_TEST_FAIL === 'viber_invite_not_opened') throw new ViberStop('viber_invite_not_opened', 'before', 'імітація');
  await android.sh(`am start -a android.intent.action.VIEW -d ${shQuote(link)} -p ${VIBER_PACKAGE}`);
  // Дешеве дерево показує, що розмова вже на екрані; будь-який інший екран (вступ, заборона, діалог) раз на кілька секунд
  // читається повним dump з текстом, щоб його розпізнати.
  const startedAt = Date.now();
  let lastDump = 0;
  let withoutInput = 0;
  let nodes = null;
  let screen = null;
  let lastKind = '';
  let relaunched = false;
  let byName = false;
  while (!screen && Date.now() - startedAt < 32_000) {
    const ready = conversationReady(await android.view());
    if (ready || (Date.now() - startedAt > 3000 && Date.now() - lastDump > 4000)) {
      // Рекламна підказка поверх розмови ховає її з dump: спершу закриваємо, потім оцінюємо екран.
      const candidate = await clearPromos(android, await android.dump());
      lastDump = Date.now();
      const found = inviteScreen(candidate, expected);
      lastKind = found.kind;
      if (found.kind === 'conversation' || found.kind === 'join' || found.kind === 'blocked') { nodes = candidate; screen = found; }
      else if (found.kind === 'no_input') {
        // Розмова без поля повідомлення: або ще вантажиться, або писати можуть лише адміни.
        withoutInput += 1;
        if (withoutInput >= 2) throw new ViberStop('viber_read_only', 'before', screenText(candidate).slice(0, 160));
      } else if (found.kind === 'list') {
        // Запрошення лишило Viber на списку чатів (16.11, щойно активований додатковий пристрій): інший спосіб відкриття, до відправки
        // це безпечно. Спершу явний компонент обробника посилань, потім уже приєднаний чат за назвою зі списку.
        const waited = Date.now() - startedAt;
        if (!relaunched && waited > 8000) {
          relaunched = true;
          await android.sh(`am start -a android.intent.action.VIEW -d ${shQuote(link)} -n ${VIBER_PACKAGE}/com.viber.voip.api.URLSchemeHandlerActivity`);
        } else if (!byName && waited > 16_000) {
          byName = true;
          const viaList = await openFromChatList(android, expected, candidate);
          if (viaList) { nodes = viaList; screen = inviteScreen(viaList, expected); }
        }
      }
    }
    if (!screen) await sleep(250);
  }
  if (!screen) {
    const finalNodes = await android.dump();
    const text = screenText(finalNodes).slice(0, 160);
    // Список чатів замість чату: запрошення не відкрилось жодним способом (окремий код, а не «діалог, якого не розпізнали»).
    if (lastKind === 'list' || looksLikeChatList(finalNodes)) throw new ViberStop('viber_invite_not_opened', 'before', text);
    throw new ViberStop('blocking_dialog', 'before', text);
  }
  if (screen.kind === 'join' && payload.openOnly) return joinPageTitle(nodes) || expected;
  if (screen.kind === 'join') {
    if (!joinPageNamesChat(nodes, expected)) throw new ViberStop('target_unconfirmed', 'before', `join page: ${screenText(nodes).slice(0, 100)}`, joinPageTitle(nodes));
    nodes = await joinChat(android, nodes, expected, guard);
    screen = inviteScreen(nodes, expected);
  }
  if (screen.kind === 'blocked') throw new ViberStop(screen.reason, 'before', screenText(nodes).slice(0, 160));
  const state = conversationState(nodes, expected);
  if (state.title && state.input && state.matches) return state.title.text;
  if (state.title && !state.matches && state.input) throw new ViberStop('target_unconfirmed', 'before', `${state.title.text}`.slice(0, 180), `${state.title.text}`.slice(0, 180));
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
  if (current !== ADB_KEYBOARD) await selectAdbKeyboard(android);
  return state;
}

/**
 * Разові рекламні панелі Viber («Create your own Remix Image» над переглядом фото, «Give images a new look» із кнопкою «Got it»
 * над розмовою) закривають поле підпису й стрічку: перегляд і підтвердження їх не бачать. Панель із «Got it» закривається
 * цією кнопкою, «Remix now» — «Назад» (перший «Назад» закриває лише її, не перегляд). true — панель була й закрита.
 */
async function dismissPromoSheet(android, nodes = null) {
  const list = nodes || await android.dump();
  return dismissKnownScreen(android, list, await android.view().catch(() => ({ activity: '' })));
}

/** Текст у поле підпису через клавіатуру ADB (див. `prepareIme`). */
async function typeCaption(android, caption, guard) {
  // Якщо клавіатуру хтось підмінив, повертаємо ADB і даємо їй час.
  if ((await android.sh('settings get secure default_input_method')).trim() !== ADB_KEYBOARD) {
    await selectAdbKeyboard(android);
    await sleep(2500);
    // Клавіатуру не вдалося зробити поточною: підпис пішов би в екранну клавіатуру, тож зупиняємось до відправки.
    if ((await android.sh('settings get secure default_input_method')).trim() !== ADB_KEYBOARD) throw new ViberStop('adbkeyboard_disabled', 'before', 'ime set');
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
      let field = viewById(await android.view(), CAPTION_FIELD);
      // Разова реклама Viber («Create your own Remix Image») закриває поле підпису: перший «Назад» закриває лише її, не перегляд.
      if (!field && !touch && await dismissPromoSheet(android)) field = viewById(await android.view(), CAPTION_FIELD);
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
  let convo = await android.until(conversationReady, { timeout: 15_000, step: 250 });
  if (!convo && await dismissPromoSheet(android)) convo = await android.until(conversationReady, { timeout: 10_000, step: 250 });
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
    // Від цього моменту повідомлення може піти: обрив більше не діє, а тайм-аут веде не в повтор, а в «потребує рішення».
    sendPressed = true;
    sendPressedAt = Date.now();
    const left = (view) => !view.activity.includes('MediaPreviewActivity');
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt += 1) {
      const view = await android.view();
      // Координати «Send» з дешевого дерева звіряються з повним dump, якщо дерево його не віддало (рядки з `aid=` раніше
      // відкидались): у dump координати вже екранні, з урахуванням letterbox-зсуву вікна.
      let send = viewById(view, 'btn_send');
      if (!send && !left(view)) send = byId(await android.dump(), 'btn_send');
      if (send && !left(view)) await android.press(send);
      sent = Boolean(await android.until(left, { timeout: 8000, step: 250 }));
    }
    if (!sent) throw new ViberStop('send_not_confirmed', 'after', 'send button did not respond');
  } finally {
    await ime.restore();
  }
}

/**
 * Правило чату «без фото» (3.17.0): звичайне текстове повідомлення прямо в розмові, без вкладення. Текст вводиться клавіатурою ADB у поле повідомлення
 * (`send_text`), звіряється повним dump, далі кнопка відправки. Якщо поле чи кнопки на екрані немає, нічого не надсилається (`before`).
 * Лише для задач із прапорцем `textOnly` (його ставить сервер за правилом чату): відсутнє фото в звичайній задачі лишається збоєм `image_missing`.
 */
const TEXT_SEND_BUTTONS = ['btn_send', 'send_button', 'btn_send_message'];
const textSendButton = (view) => TEXT_SEND_BUTTONS.map((id) => viewById(view, id)).find((item) => item && item.visible !== false);
async function sendTextOnly(android, text, guard, ime) {
  let convo = await android.until(conversationReady, { timeout: 15_000, step: 250 });
  if (!convo && await dismissPromoSheet(android)) convo = await android.until(conversationReady, { timeout: 10_000, step: 250 });
  if (!convo) throw new ViberStop('send_ui_unavailable', 'before', 'conversation');
  guard();
  step('text', 'вводжу текст');
  try {
    if ((await android.sh('settings get secure default_input_method')).trim() !== ADB_KEYBOARD) {
      await selectAdbKeyboard(android);
      await sleep(2500);
    }
    let focused = false;
    for (let touch = 0; touch < 4 && !focused; touch += 1) {
      const field = viewById(await android.view(), 'send_text');
      if (!field) throw new ViberStop('send_ui_unavailable', 'before', 'message field');
      if (!field.focused) { guard(); await android.tap(field); await sleep(700); }
      focused = Boolean(viewById(await android.view(), 'send_text')?.focused);
    }
    if (!focused) throw new ViberStop('send_ui_unavailable', 'before', 'message field focus');
    await sleep(400);
    const wanted = looseName(text);
    const base64 = Buffer.from(text, 'utf8').toString('base64');
    let typed = '';
    for (let attempt = 0; attempt < 2 && looseName(typed) !== wanted; attempt += 1) {
      await android.sh(`am broadcast -a ADB_INPUT_B64 --es msg ${base64}`);
      for (let poll = 0; poll < 3 && looseName(typed) !== wanted; poll += 1) {
        await sleep(poll === 0 ? 300 : 700);
        typed = byId(await android.dump(), 'send_text')?.text || '';
      }
      // Частковий набір не дописуємо вдруге: лише порожнє поле повторюється.
      if (looseName(typed) !== wanted && typed.trim() && !/^(?:message|type a message|write a message)/i.test(typed.trim())) throw new ViberStop('send_ui_unavailable', 'before', 'text mismatch');
    }
    if (looseName(typed) !== wanted) throw new ViberStop('send_ui_unavailable', 'before', 'text not typed');
    currentLaps?.lap('текст');
    const sendNow = textSendButton(await android.view());
    if (!sendNow) throw new ViberStop('send_ui_unavailable', 'before', 'send button');
    step('send', 'надсилаю');
    guard();
    // Від цього моменту повідомлення може піти: обрив більше не діє, а тайм-аут веде в «потребує рішення».
    sendPressed = true;
    sendPressedAt = Date.now();
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt += 1) {
      const button = textSendButton(await android.view());
      const field = byId(await android.dump(), 'send_text');
      if (field && looseName(field.text) !== wanted) { sent = true; break; }
      if (button) await android.press(button);
      sent = Boolean(await android.until((view) => !looseName(viewById(view, 'send_text')?.text || '').startsWith(wanted.slice(0, 20)) || !viewById(view, 'send_text'), { timeout: 8000, step: 250 }));
    }
    if (!sent) throw new ViberStop('send_not_confirmed', 'after', 'send button did not respond');
  } finally {
    await ime.restore();
  }
}

// ---------------------------------------------------------------- Пошук нашого повідомлення в стрічці
//
// Правда з живих даних 2026-10-26 (11 чатів «send_not_confirmed» / «message_not_found»): вікно Viber у Waydroid плаває й має довільний
// розмір (там ≈465×640 px), а повідомлення з фото й довгим підписом вище за нього, тож (1) час під повідомленням не видно, коли воно
// впирається в низ вікна, і (2) жести прокрутки з фіксованими координатами (x=850) падали повз вікно й стрічка не гортилась. Тепер жести
// рахуються від меж `conversation_recycler_view`, а час повідомлення читається після невеликої прокрутки, якщо його закриває край вікна.

const stampMinutes = (text) => {
  const match = String(text || '').replace(/[\s  ]+/g, ' ').trim().match(/^(\d{1,2}):(\d{2}) (AM|PM)$/i);
  if (!match) return null;
  return ((Number(match[1]) % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(match[2]);
};
/** Скільки хвилин тому було `stamp` відносно `reference` (за добу з урахуванням півночі): додатне — раніше. */
const minutesBefore = (reference, stamp) => ((reference - stamp) % 1440 + 1440) % 1440;
const clockMinutes = ({ hours, minutes }) => hours * 60 + minutes;

/** Повідомлення з підписом серед усіх текстових вузлів стрічки: у жвавому чаті чужі повідомлення вже лежать нижче за наше. */
function findOwnMessage(nodes, prefix) {
  const texts = nodes.filter((node) => node.id === 'textMessageView').sort((a, b) => b.bottom - a.bottom);
  if (!prefix) return texts[0] ?? null;
  return texts.find((node) => looseName(node.text).startsWith(prefix)) ?? null;
}

/** Час під повідомленням: перший `timestampView` одразу під текстом (у межах повідомлення); null — час не видно. */
function stampBelow(nodes, message) {
  const next = nodes.filter((node) => node.id === 'textMessageView' && node.top > message.top + 5).sort((a, b) => a.top - b.top)[0];
  const limit = next ? next.top : Infinity;
  const stamp = nodes.filter((node) => node.id === 'timestampView' && node.top >= message.top && node.top < limit && node.top - message.bottom < 90).sort((a, b) => a.top - b.top)[0];
  return stamp ? stampMinutes(stamp.text) : null;
}

async function conversationFrame(android) {
  const frame = viewById(await android.view(), 'conversation_recycler_view');
  if (!frame) throw new ViberStop('send_ui_unavailable', 'before', 'conversation list');
  return frame;
}

/** Гортає стрічку всередині її вікна: 'older' — до давніших повідомлень, 'newer' — до новіших; `fraction` — частка висоти вікна. */
async function scrollConversation(android, direction, fraction = 0.7, xRatio = 0.5) {
  const frame = await conversationFrame(android);
  // Жест по самому повідомленню (відео, опитування, «відповісти свайпом») стрічку не гортає: x можна зсунути до краю вікна.
  const x = Math.round(frame.left + (frame.right - frame.left) * xRatio);
  const height = frame.bottom - frame.top;
  // Угорі вікна може лежати закріплене повідомлення («Pinned by…», ≈60 px): жест, що почався на ньому, стрічку не гортає, тож і початок, і кінець
  // жесту беремо всередині від країв: від 18 % висоти зверху до 4 % знизу.
  const upper = Math.round(frame.top + height * 0.18);
  const lower = Math.round(frame.bottom - height * 0.04);
  const span = Math.max(60, Math.round((lower - upper) * (fraction / 0.85)));
  const from = direction === 'older' ? upper : Math.min(lower, upper + span);
  const to = direction === 'older' ? Math.min(lower, upper + span) : upper;
  await android.sh(`input swipe ${x} ${from} ${x} ${to} 260`);
  await sleep(700);
}

/** Кнопка «униз» у стрічці (є, коли нижче лишились непрочитані): повертає до найновіших повідомлень. */
async function jumpToBottom(android) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const jump = viewById(await android.view(), 'btn_jump_to_bottom');
    if (!jump) return;
    await android.press(jump);
    await sleep(900);
  }
}

/**
 * До найновіших повідомлень: кнопка «униз» (якщо є) і далі жести до самого низу, поки екран перестає змінюватись. Після відправки
 * довгого повідомлення з фото Viber не завжди сам прокручує стрічку до нього.
 */
async function scrollToBottom(android) {
  await jumpToBottom(android);
  let previous = '';
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const nodes = await android.dump();
    const signature = nodes.filter((node) => ['textMessageView', 'timestampView', 'imageView', 'nameView'].includes(node.id)).map((node) => `${node.id}:${node.top}:${(node.text || '').slice(0, 10)}`).join('|');
    if (signature && signature === previous) return;
    previous = signature;
    await scrollConversation(android, 'newer', 0.85);
  }
}

/**
 * Шукає наше повідомлення (за початком підпису) від найновіших до давніших, поки не знайде або не пройде час відправки.
 * `sentAt` — хвилина доби, коли повідомлення відправлялось; допустиме вікно часу [sentAt-4, sentAt+2] хв.
 * Повертає { state: 'found' } або { state: 'absent' } (прогорнули повз момент відправки, нашого немає) або { state: 'unknown', why }
 * (час не вдалося визначити, стрічка не гортається, ліміт сторінок).
 */
async function locateOwnMessage(android, prefix, { sentAt, maxPages = 10, guard = () => {} }) {
  // `copies`: скільки повідомлень з цим початком бачили за сьогодні, але з часом поза вікном (для «Перевірити»: повторювати відправку тоді небезпечно).
  let copies = 0;
  const absent = () => ({ state: 'absent', copies });
  if (!prefix) return absent();
  // `sentAt` null — час відправки невідомий: підходить будь-яке повідомлення з цим початком за сьогодні (до межі доби).
  const known = sentAt !== null && sentAt !== undefined;
  const reference = known ? sentAt : clockMinutes(await android.clock());
  const inWindow = (minute) => { const delta = minutesBefore(reference, minute); return known ? delta <= 4 || delta >= 1440 - 2 : true; };
  const olderThanWindow = (minute) => known && (() => { const delta = minutesBefore(reference, minute); return delta > 4 && delta < 720; })();
  await scrollToBottom(android);
  let lastSignature = '';
  let stuckTries = 0;
  let previousTopStamp = null;
  for (let page = 0; page < maxPages; page += 1) {
    guard();
    if (await android.keyboardShown()) { await android.key(4); await sleep(500); }
    let nodes = await android.dump();
    const state = conversationStateOf(nodes);
    if (!state) return { state: 'unknown', why: 'conversation not shown' };
    // Межа доби: угору час має спадати, а різкий стрибок угору означає, що вище вже вчорашні повідомлення.
    const stampNodes = nodes.filter((node) => node.id === 'timestampView').map((node) => ({ top: node.top, bottom: node.bottom, minute: stampMinutes(node.text) })).filter((item) => item.minute !== null).sort((a, b) => a.top - b.top);
    // Між сторінками теж можна перетнути північ: найдавніший час на новій сторінці різко більший за найдавніший на попередній.
    if (previousTopStamp !== null && stampNodes.length && stampNodes[0].minute > previousTopStamp + 30) return absent();
    if (stampNodes.length) previousTopStamp = stampNodes[0].minute;
    // Межа доби: заголовок дати («Today, 18 Nov») над повідомленням або різкий стрибок часу між сусідніми повідомленнями. Повідомлення
    // нової доби лежать нижче межі, а їхній час стоїть під текстом, тож межа — це низ часу ВИЩОГО (старішого) повідомлення, а не верх
    // нижнього: інакше перше повідомлення нової доби (текст вище за свій час) відкидалось як вчорашнє (2026-11-18, хибне send_not_confirmed).
    let dayBoundaryTop = null;
    for (let index = 0; index < stampNodes.length - 1; index += 1) {
      if (stampNodes[index].minute > stampNodes[index + 1].minute + 30) { dayBoundaryTop = stampNodes[index].bottom; break; }
    }
    const todayHeader = nodes.filter((node) => node.id === 'dateHeaderView' && /^today\b/i.test(String(node.text || '').trim())).sort((x, y) => y.top - x.top)[0];
    if (todayHeader && (dayBoundaryTop === null || todayHeader.top < dayBoundaryTop)) dayBoundaryTop = todayHeader.top;
    const own = nodes.filter((node) => node.id === 'textMessageView' && looseName(node.text).startsWith(prefix) && (dayBoundaryTop === null || node.top >= dayBoundaryTop - 4)).sort((a, b) => b.bottom - a.bottom);
    for (const message of own) {
      let minute = stampBelow(nodes, message);
      if (minute === null) {
        // Нижній край повідомлення за вікном: підсуваємо стрічку вниз, щоб показався час.
        await scrollConversation(android, 'newer', 0.35);
        nodes = await android.dump();
        const moved = nodes.filter((node) => node.id === 'textMessageView' && looseName(node.text).startsWith(prefix)).sort((a, b) => b.bottom - a.bottom);
        const same = moved.find((node) => node.text === message.text) || moved[0];
        minute = same ? stampBelow(nodes, same) : null;
        if (minute === null) return { state: 'unknown', why: 'timestamp hidden' };
      }
      if (inWindow(minute)) return { state: 'found', minute };
      copies += 1;
      // Копія з іншим часом (учорашня чи давніша): не наша, шукаємо далі.
    }
    const stamps = stampNodes.map((item) => item.minute);
    // Усе видиме вже давніше за момент відправки: далі лише давніші повідомлення, нашого немає.
    if (process.env.WORK_OS_VIBER_DEBUG) console.error(`locate page ${page} sentAt=${sentAt} own=${own.length} stamps=${stamps.join(',')} texts=${nodes.filter((n) => n.id === 'textMessageView').map((n) => `${n.top}-${n.bottom}:${n.text.slice(0, 12)}`).join(' | ')}`);
    if (dayBoundaryTop !== null) return absent();
    if (stamps.length && stamps.every(olderThanWindow)) return absent();
    // Підпис екрана: усі вузли повідомлень (текст, час, фото, відправник): одна велика картинка без тексту теж змінюється при прокрутці.
    const signature = nodes.filter((node) => ['textMessageView', 'timestampView', 'imageView', 'nameView', 'avatarView'].includes(node.id)).map((node) => `${node.id}:${node.top}:${(node.text || '').slice(0, 12)}`).join('|');
    if (page > 0 && signature === lastSignature) {
      // Стрічка не зсунулась: жест міг потрапити на повідомлення, яке його поглинає. Пробуємо край вікна, потім інший край.
      stuckTries += 1;
      if (stuckTries >= 3) return stamps.length && stamps.some(olderThanWindow) ? absent() : { state: 'unknown', why: 'start of chat or list stuck' };
    } else stuckTries = 0;
    lastSignature = signature;
    await scrollConversation(android, 'older', 0.85, stuckTries === 0 ? 0.5 : stuckTries === 1 ? 0.04 : 0.96);
  }
  return { state: 'unknown', why: 'page limit' };
}

/** Назва розмови з дерева (без перевірки збігу): null, якщо розмови немає на екрані. */
function conversationStateOf(nodes) {
  const title = nodes.find((node) => node.id === 'title' && node.top < 260);
  return title ? { title } : null;
}

async function confirmSent(android, caption, targetName) {
  step('confirm', 'перевіряю, що повідомлення в чаті');
  const conversation = await android.until(conversationReady, { timeout: 25_000, step: 250 });
  if (!conversation) throw new ViberStop('send_not_confirmed', 'after', 'conversation not shown');
  const prefix = looseName(caption).slice(0, 24);
  // Повідомлення з'являється в стрічці не миттєво (Viber спершу обробляє фото): шукаємо, поки воно не зʼявиться, до 40 с.
  // Після «Send» іншої безпечної дії немає, а хибне «не підтверджено» віддало б власнику вже надісланий чат.
  const deadline = Date.now() + 40_000;
  let last = { state: 'unknown', why: 'not searched' };
  for (let attempt = 0; attempt === 0 || Date.now() < deadline; attempt += 1) {
    if (attempt) await sleep(1200);
    // Після відправки меню «+» іноді лишається відкритим: воно стискає стрічку.
    const view = await android.view();
    const plus = viewById(view, 'options_menu_open_more');
    if (plus && viewById(view, 'options_more_menu_gallery')) {
      await android.press(plus);
      await android.until((next) => !viewById(next, 'options_more_menu_gallery'), { timeout: 2500, step: 200 });
    }
    const nodes = await android.dump();
    const opened = conversationState(nodes, targetName);
    if (!opened.title) { await dismissPromoSheet(android, nodes); continue; }
    if (!opened.matches) throw new ViberStop('target_unconfirmed', 'after', opened.title.text.slice(0, 80), opened.title.text.slice(0, 180));
    const sentAt = clockMinutes(await android.clock());
    last = await locateOwnMessage(android, prefix, { sentAt, maxPages: 3 });
    if (last.state === 'found') break;
  }
  if (last.state !== 'found') throw new ViberStop('send_not_confirmed', 'after', `new message not found (${last.state}${last.why ? `: ${last.why}` : ''})`);
  // Червоний значок статусу під нашим повідомленням означає «не відправлено».
  const nodes = await android.dump();
  const mine = findOwnMessage(nodes, prefix);
  const status = mine && nodes.find((node) => node.id === 'statusView' && node.top >= mine.top - 10 && node.top <= mine.bottom + 40);
  if (status && await statusLooksFailed(android, status)) throw new ViberStop('send_not_confirmed', 'after', 'message marked as not sent');
}

/**
 * Дія «Перевірити»: відкриває чат і лише дивиться, чи є в ньому повідомлення з цим підписом, надісланe приблизно тоді, коли
 * відправка закінчилась невизначено. Нічого не надсилає. Стрічка гортається від найновіших до моменту відправки: знайшли — «є»;
 * прогорнули повз момент відправки й нашого немає — `message_not_found` (дозволяє один автоматичний повтор); не вдалось визначити —
 * `verify_inconclusive` (не «немає»: повтор міг би дати дубль).
 */
async function verify(payload, guard) {
  guard();
  step('env', 'перевіряю Waydroid і Viber');
  const android = await withStep('перевірка середовища', STEP_LIMITS_MS.env, async () => {
    const connected = await connectQuick();
    currentAndroid = connected;
    await ensureEnvironment(connected);
    await preflight(connected);
    return connected;
  });
  guard();
  step('open', 'відкриваю чат');
  const targetName = await withStep('відкриття чату', STEP_LIMITS_MS.open, () => openTarget(android, payload, guard));
  step('confirm', 'шукаю повідомлення в чаті');
  const prefix = looseName(String(payload.message || '')).slice(0, 24);
  if (!prefix) throw new ViberStop('message_not_found', 'before', 'empty caption');
  const sinceEpoch = Number(payload.sinceEpoch) || 0;
  const ageSeconds = sinceEpoch ? Math.max(0, Math.round(Date.now() / 1000 - sinceEpoch)) : 0;
  if (ageSeconds > 600 * 60) throw new ViberStop('message_not_found', 'before', 'sent too long ago');
  const startedVerifyAt = Date.now();
  const found = await withStep('пошук повідомлення', STEP_LIMITS_MS.verify, async () => {
    // Свіжа відправка: Viber міг ще вантажити фото, тож «немає» підтверджуємо повторним проходом не раніше ніж за 100 с після відправки.
    for (let round = 0; round < 3; round += 1) {
      guard();
      const sentAt = sinceEpoch ? clockMinutes(await android.clock()) - Math.round((ageSeconds + round * 30) / 60) : null;
      const result = await locateOwnMessage(android, prefix, { sentAt, maxPages: 26, guard });
      if (result.state === 'found') return result;
      const youngSeconds = ageSeconds + (Date.now() - startedVerifyAt);
      if (result.state === 'unknown') throw new ViberStop('verify_inconclusive', 'before', result.why || '');
      if (youngSeconds >= 100) return result;
      await sleep(Math.min(30_000, (100 - youngSeconds) * 1000));
    }
    return { state: 'absent' };
  });
  if (found.state === 'found') return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: targetName, timings: 'перевірено, повідомлення є в чаті' };
  // Копія з тим самим підписом за сьогодні є, але час не збігся: «немає» тут небезпечне (повторна відправка дала б дубль), віддаємо власнику.
  if (found.copies > 0) throw new ViberStop('verify_inconclusive', 'before', `same caption found today at another time (${found.copies})`);
  throw new ViberStop('message_not_found', 'before', 'message not in chat');
}
// ---------------------------------------------------------------- Дії для runner

async function status() {
  // Поки задача виконується, `adb` паралельно не запускаємо: це лише заважає відправці й давало хибне «Viber не відповів».
  if (activeTask) return { ok: true, status: 'busy', reason: null, severity: 'env', detail: `надсилаю в «${activeTask.name}»: ${activeTask.step}` };
  const android = await connect();
  await checkEnvironment(android);
  await cleanupIdleImages(android);
  return { ok: true, status: 'ready', reason: null, severity: 'env', detail: '' };
}

/**
 * Відбиток середовища Viber (3.18.0): розмір і режим дисплея Android, версії Viber/Android/Waydroid, стан ADBKeyBoard. Зміна будь-
 * чого з цього вимагає пробної відправки (див. `autopost-health.mjs`). Поки йде задача, `adb` не чіпаємо: повертає null.
 */
export async function viberFingerprint() {
  if (activeTask || process.platform !== 'linux') return null;
  // Android після пробудження чи перезапуску сесії ще не готовий (adb offline, `sys.boot_completed` ≠ 1): чекаємо до хвилини й лише
  // тоді знімаємо відбиток. Не дочекались — null («зараз зібрати не можна»), а не відбиток із порожніми полями, який виглядав би зміною.
  const android = await Promise.race([
    connectQuick().catch(() => null),
    sleep(60_000).then(() => null),
  ]);
  if (!android) return null;
  const booted = (await android.sh('getprop sys.boot_completed', { timeout: 8000 }).catch(() => '')).trim();
  if (booted !== '1') return null;
  const get = async (command) => String(await android.sh(command, { timeout: 10_000 }).catch(() => '')).trim();
  const keyboardPath = await get(`pm path ${ADB_KEYBOARD_PACKAGE}`);
  const enabled = (await enabledImes(android).catch(() => [])).includes(ADB_KEYBOARD);
  const waydroid = await run('waydroid', ['--version'], { timeout: 8000 }).catch(() => ({ stdout: '' }));
  const print = {
    android: await get('getprop ro.build.version.release'),
    display: (await get('wm size')).replace(/^Physical size:\s*/i, ''),
    multiWindows: await get('getprop persist.waydroid.multi_windows'),
    viber: (await get(`dumpsys package ${VIBER_PACKAGE} | grep -m1 versionName`)).replace(/^versionName=/, ''),
    waydroid: String(waydroid.stdout || '').trim().split('\n')[0].slice(0, 40),
    adbKeyboard: keyboardPath.includes('package:') ? (enabled ? 'увімкнена' : 'вимкнена') : 'немає',
  };
  // Частина полів не прочиталась (Android ще збирається): неповний відбиток не віддаємо.
  return print.android && print.display && print.viber ? print : null;
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
  const android = await withStep('перевірка середовища', STEP_LIMITS_MS.env, async () => {
    const connected = await connectQuick();
    currentAndroid = connected;
    await ensureEnvironment(connected);
    await preflight(connected);
    return connected;
  });
  laps.lap('adb');
  guard();
  const caption = String(payload.message || '');
  const ime = await prepareIme(android, caption);
  try {
    // Фото кладеться паралельно з відкриттям чату: до галереї воно вже буде в індексі.
    // Правило чату «без фото»: фото не кладемо, повідомлення піде звичайним текстом.
    const textOnly = payload.textOnly === true;
    const image = textOnly || payload.openOnly ? Promise.resolve(null) : freshImage(android, payload.media);
    image.catch(() => {});
    step('open', 'відкриваю чат');
    const targetName = await withStep('відкриття чату', STEP_LIMITS_MS.open, () => openTarget(android, payload, guard));
    laps.lap('чат');
    guard();
    // Пробна перевірка відкриття запрошення (3.18.0): чат відкрито, нічого не надсилаємо й нікуди не вступаємо.
    if (payload.openOnly) return { ok: true, status: 'checked', reason: null, severity: 'before', observedTarget: targetName, timings: laps.text() };
    await withStep('фото', STEP_LIMITS_MS.photo, () => image);
    laps.lap('фото');
    guard();
    await withStep(textOnly ? 'текст і відправка' : 'фото, підпис і відправка', STEP_LIMITS_MS.send, () => (textOnly ? sendTextOnly(android, caption, guard, ime) : attachAndSend(android, caption, guard, ime)));
    laps.lap('відправка');
    await withStep('підтвердження', STEP_LIMITS_MS.confirm, () => confirmSent(android, caption, targetName));
    laps.lap('підтвердження');
    lastPostAt = Date.now();
    return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: targetName, timings: laps.text() };
  } catch (error) {
    // Крок обірвано сторожем: свіжий контролер, щоб відновлення (клавіатура, force-stop) не підхопило той самий обрив.
    if (error instanceof ViberStop) taskController = new AbortController();
    throw error;
  } finally {
    await ime.restore().catch(() => {});
  }
}

/**
 * @param {'status'|'post'|'verify'} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{ok:boolean,status:string,reason?:string|null,severity?:string,detail?:string,[key:string]:unknown}>}
 */
export async function runViberAndroid(action, payload = {}, { shouldAbort = () => false, onStep = () => {} } = {}) {
  if (process.platform !== 'linux') return { ok: true, status: 'skipped', reason: 'viber_unsupported_platform', severity: 'env' };
  // Вікна Android (multi_windows у Waydroid) ховаються правилом Hyprland до того, як Viber відкриє перше з них.
  await hideAndroidWindows().catch(() => {});
  // Поза Hyprland (GNOME, KDE) окремих вікон Android не буває, поки `persist.waydroid.multi_windows` вимкнено.
  await ensureSingleWindowMode().catch(() => {});
  // Перевірка стану під час відправки не чіпає ні adb, ні контролер задачі: вона лише повідомляє, що адаптер зайнятий.
  if (action === 'status') {
    try { return await status(); } catch (error) {
      if (error instanceof ViberStop) return { ok: false, status: 'blocked', reason: error.reason, severity: 'env', detail: error.detail };
      return { ok: false, status: 'failed', reason: 'helper_error', severity: 'after', detail: String(error?.message || error).slice(0, 160) };
    }
  }
  if (activeTask) return { ok: false, status: 'blocked', reason: 'helper_busy', severity: 'env', detail: `адаптер зайнятий: ${activeTask.name}` };
  let timer;
  const startedAt = Date.now();
  taskController = new AbortController();
  activeTask = { name: String(payload.expectedName || 'чат'), step: 'початок', startedAt };
  sendPressed = false;
  sendPressedAt = 0;
  try {
    // Скасування оператором («Зупинити») діє до відправки: після нього жодного нового кроку.
    const guard = () => { if (shouldAbort()) throw new ViberStop('cancelled', 'before'); };
    currentLaps = null;
    emitStep = onStep;
    const work = action === 'verify' ? verify(payload, guard) : post(payload, guard);
    work.catch(() => {});
    // Спільний сторож на задачу: перебиває будь-який крок, що пережив власний ліміт (наприклад, довгий `sleep` чи процес поза `run`).
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const stop = sendPressed
          ? new ViberStop('helper_timeout', 'after', `задача не вклалась у ${Math.round(POST_TIMEOUT_MS / 1000)} с, крок «${activeTask?.step}»`)
          : new ViberStop('viber_task_timeout', 'before', `задача не вклалась у ${Math.round(POST_TIMEOUT_MS / 1000)} с, крок «${activeTask?.step}»`);
        abortTask(stop);
        reject(stop);
      }, action === 'verify' ? VERIFY_TIMEOUT_MS : POST_TIMEOUT_MS);
    });
    return await Promise.race([work, limit]);
  } catch (error) {
    // Обрив міг лишити відхилений контролер: далі працюємо зі свіжим (знімок екрана, force-stop).
    if (taskController?.signal.aborted) taskController = new AbortController();
    const spent = Math.round((Date.now() - startedAt) / 1000);
    if (error instanceof ViberStop && error.severity !== 'env' && error.reason !== 'cancelled' && currentAndroid) {
      // Що було на екрані в момент збою: текст у деталі журналу й знімок поруч із журналом runner (з власним лімітом, щоб не повісити відповідь).
      try {
        await Promise.race([(async () => {
          const nodes = await currentAndroid.dump();
          error.detail = `${error.detail} | screen: ${screenText(nodes).slice(0, 160)}${currentLaps ? ` | ${currentLaps.text()}` : ''}`.trim();
          const shot = await currentAndroid.adb(['exec-out', 'screencap', '-p'], { timeout: 15_000, buffer: true });
          const dir = join(homedir(), '.local', 'state', 'work-os');
          await mkdir(dir, { recursive: true });
          if (Buffer.isBuffer(shot.stdout) && shot.stdout.length > 1000) await writeFile(join(dir, 'viber-last-failure.png'), shot.stdout);
          // Невідомий стан: знімок із деревом екрана в теці збоїв (14 днів, ≤ 200 МБ), щоб власник міг передати його на виправлення.
          if (UNKNOWN_STATE_REASONS.has(error.reason)) {
            const tree = nodes.map((node) => `${node.id}\t${node.cls}\t${JSON.stringify(node.text)}\t${JSON.stringify(node.desc)}\t[${node.left},${node.top}][${node.right},${node.bottom}]`).join('\n');
            saveFailureSnapshot({ platform: 'viber', code: error.reason, png: Buffer.isBuffer(shot.stdout) ? shot.stdout : null, tree, detail: error.detail, extra: { target: activeTask?.name } });
          }
        })(), sleep(20_000)]);
      } catch { /* діагностика не має ламати відповідь */ }
    }
    // Крок завис до «Send»: Viber, найімовірніше, у глухому стані. Зупиняємо його, щоб наступний чат почав із чистого запуску; після
    // «Send» нічого не чіпаємо: фото може ще вантажитись.
    if (error instanceof ViberStop && (error.reason === 'viber_step_timeout' || error.reason === 'viber_task_timeout') && currentAndroid) {
      try { await currentAndroid.sh(`am force-stop ${VIBER_PACKAGE}`, { timeout: 10_000 }); preflightOkAt = 0; } catch { /* лишається для наступного preflight */ }
    }
    if (error instanceof ViberStop) {
      const detail = `${error.detail}${error.reason === 'cancelled' ? '' : ` | пройшло ${spent} с`}`.trim();
      return { ok: false, status: error.severity === 'env' ? 'blocked' : error.severity === 'after' ? 'failed' : 'skipped', reason: error.reason, severity: error.severity, detail, ...(error.observed ? { observedTarget: error.observed } : {}), ...(sendPressedAt ? { sentAt: Math.floor(sendPressedAt / 1000) } : {}) };
    }
    return { ok: false, status: 'failed', reason: 'helper_error', severity: 'after', detail: String(error?.message || error).slice(0, 160) };
  } finally { clearTimeout(timer); emitStep = () => {}; activeTask = null; taskController = null; sendPressed = false; }
}

/** Дані завдання черги → вхід адаптера. */
export function viberPayloadFromTask(task, overrides = {}) {
  return {
    id: task.jobId,
    url: task.target?.expectedLink || '',
    expectedName: task.target?.expectedName || '',
    message: task.material?.text || '',
    media: task.material?.media || null,
    // Правило чату «без фото»: лише текстове повідомлення (див. `sendTextOnly`).
    textOnly: task.material?.textOnly === true,
    ...overrides,
  };
}
