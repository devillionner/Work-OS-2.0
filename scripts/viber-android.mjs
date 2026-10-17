// Автопост у Viber через Android у Waydroid: runner керує застосунком Viber за допомогою `adb` (uiautomator, input, am).
// Waydroid і Viber запускає оператор; runner лише перевіряє, що вони готові. Контракт відповіді той самий, що був у
// Linux-помічника: { status: 'ready'|'sent'|'skipped'|'failed', reason, severity: 'env'|'before'|'after', detail }.
// Принцип: усе, що неоднозначне, закінчується без відправки; після натискання «Send» ніщо не повторюється.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VIBER_PACKAGE = 'com.viber.voip';
const VIBER_LAUNCH = 'com.viber.voip/.WelcomeActivity';
const MEDIA_PERMISSION = 'android.permission.READ_MEDIA_IMAGES';
const REMOTE_UI_DUMP = '/sdcard/workos-ui.xml';
const POST_TIMEOUT_MS = 4 * 60 * 1000;
// Фото для відправки лежить у Pictures Android лише на час партії: через 3 хв без відправок воно видаляється.
const IMAGE_PREFIX = 'workos-autopost-';
const IMAGE_KEEP_MS = 3 * 60 * 1000;
let lastPostAt = 0;

/** Короткі пояснення для журналу й значка в треї; повні тексти для оператора живуть на сайті. */
export const VIBER_ENV_REASON_TEXT = {
  viber_unsupported_platform: 'Автопост Viber працює лише на Linux',
  adb_missing: 'Не встановлено adb (пакет android-tools)',
  waydroid_missing: 'Не встановлено Waydroid',
  waydroid_not_running: 'Waydroid не запущений',
  waydroid_frozen: 'Контейнер Waydroid заморожений',
  android_unreachable: 'Android у Waydroid недоступний для adb',
  android_unauthorized: 'adb не авторизований в Android',
  viber_not_installed: 'У Waydroid не встановлений Viber',
  viber_not_activated: 'Viber у Waydroid не активований',
  viber_language: 'Мова Android має бути англійською',
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
      await sleep(800);
    }
    return [];
  }

  /** Ждёмо, поки предикат знайде щось у дереві; повертає { nodes, hit } або null. */
  async waitFor(predicate, timeoutMs = 20_000, stepMs = 900) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const nodes = await this.dump();
      const hit = predicate(nodes);
      if (hit) return { nodes, hit };
      await sleep(stepMs);
    }
    return null;
  }

  tap(node) { return this.sh(`input tap ${node.x} ${node.y}`); }
  key(code) { return this.sh(`input keyevent ${code}`); }
  /** Довший дотик: перший короткий інколи губиться, поки екран ще оновлюється. */
  press(node) { return this.sh(`input swipe ${node.x} ${node.y} ${node.x} ${node.y} 150`); }
  async focusLine() { return (await this.sh('dumpsys window | grep -m1 mCurrentFocus')).trim(); }
  async clock() {
    const [hours, minutes] = (await this.sh('date +%H:%M')).trim().split(':').map(Number);
    return { hours, minutes };
  }
}

async function connect() {
  if ((await run('adb', ['version'], { timeout: 8000 })).error?.code === 'ENOENT') throw new ViberStop('adb_missing', 'env');
  const state = await waydroidState();
  if (state.session !== 'RUNNING') throw new ViberStop('waydroid_not_running', 'env');
  if (state.container !== 'RUNNING') throw new ViberStop(state.container === 'FROZEN' ? 'waydroid_frozen' : 'waydroid_not_running', 'env', state.container);
  if (!state.ip) throw new ViberStop('android_unreachable', 'env', 'no ip');
  const serial = `${state.ip}:5555`;
  await run('adb', ['connect', serial], { timeout: 12_000 });
  const devices = await run('adb', ['devices'], { timeout: 8000 });
  const line = String(devices.stdout).split('\n').find((row) => row.startsWith(serial)) || '';
  if (/unauthorized/.test(line)) throw new ViberStop('android_unauthorized', 'env');
  if (!/\bdevice\b/.test(line)) throw new ViberStop('android_unreachable', 'env', line.trim());
  return new Android(serial);
}

async function checkEnvironment(android) {
  const installed = await android.sh(`pm path ${VIBER_PACKAGE}`, { timeout: 15_000 });
  if (!installed.includes('package:')) throw new ViberStop('viber_not_installed', 'env');
  const locale = (await android.sh('getprop persist.sys.locale')).trim() || (await android.sh('getprop ro.product.locale')).trim() || 'en-US';
  if (!/^en/i.test(locale)) throw new ViberStop('viber_language', 'env', locale);
}

// ---------------------------------------------------------------- Екрани Viber

const screenText = (nodes) => nodes.map((node) => `${node.text} ${node.desc}`.trim()).filter(Boolean).join(' | ');
const byId = (nodes, id) => nodes.find((node) => node.id === id);

/** Рекламні «підказки» Viber закриваються кнопкою «назад»; будь-який інший діалог зупиняє відправку. */
async function clearPromos(android, nodes) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (/isn.?t responding/i.test(screenText(nodes))) {
      const wait = nodes.find((node) => node.text === 'Wait');
      if (wait) { await android.tap(wait); await sleep(2500); nodes = await android.dump(); continue; }
    }
    const promo = byId(nodes, 'bottom_sheet_title') && byId(nodes, 'touch_outside');
    if (!promo) return nodes;
    await android.key(4);
    await sleep(1200);
    nodes = await android.dump();
  }
  return nodes;
}

async function openChatList(android) {
  await android.key(3);
  await sleep(800);
  await android.sh(`am start -n ${VIBER_LAUNCH}`);
  const found = await android.waitFor((nodes) => (byId(nodes, 'menu_search') && nodes.some((node) => node.id === 'from' || node.id === 'subject')) ? nodes : null, 40_000, 1500);
  if (found) return clearPromos(android, found.nodes);
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

function classifyBlockedScreen(text) {
  if (/no longer|does(?:n.?t| not) exist|not exist|invalid|expired|not valid|unavailable/i.test(text)) return 'viber_chat_missing';
  if (/banned|blocked|removed you|can.?t join|not allowed/i.test(text)) return 'viber_banned';
  if (/only admins?|admins? can/i.test(text)) return 'viber_read_only';
  if (/\bjoin\b/i.test(text)) return 'viber_not_joined';
  return '';
}

async function openTarget(android, payload) {
  const expected = String(payload.expectedName || '').trim();
  if (!expected) throw new ViberStop('target_name_missing', 'before');
  if (payload.testTarget === 'my_notes') {
    const list = await openChatList(android);
    const row = list.find((node) => node.id === 'from' && node.text === 'My Notes');
    if (!row) throw new ViberStop('target_not_found', 'before', 'My Notes');
    await android.tap(row);
    const opened = await android.waitFor((nodes) => (conversationState(nodes, 'My Notes').input ? nodes : null), 15_000);
    if (!opened) throw new ViberStop('target_unconfirmed', 'before', 'My Notes');
    return 'My Notes';
  }
  const link = String(payload.url || '').trim();
  if (!/^https:\/\/invite\.viber\.com\//i.test(link)) throw new ViberStop('invalid_viber_link', 'before');
  await openChatList(android);
  await android.sh(`am start -a android.intent.action.VIEW -d ${shQuote(link)} -p ${VIBER_PACKAGE}`);
  let nodes = null;
  const found = await android.waitFor((candidate) => {
    const state = conversationState(candidate, expected);
    if (state.title && (state.input || candidate.some((node) => node.click && /^join/i.test(node.text)))) return candidate;
    return classifyBlockedScreen(screenText(candidate)) ? candidate : null;
  }, 30_000, 1500);
  if (found) nodes = await clearPromos(android, found.nodes);
  if (!nodes) throw new ViberStop('blocking_dialog', 'before', screenText(await android.dump()).slice(0, 160));
  const state = conversationState(nodes, expected);
  if (state.title && state.input && state.matches) return state.title.text;
  if (state.title && !state.matches && state.input) throw new ViberStop('target_unconfirmed', 'before', `${state.title.text}`.slice(0, 80));
  const reason = classifyBlockedScreen(screenText(nodes)) || (state.title && !state.input ? 'viber_read_only' : 'blocking_dialog');
  throw new ViberStop(reason, 'before', screenText(nodes).slice(0, 160));
}

// ---------------------------------------------------------------- Фото

async function ensureImage(android, media) {
  if (!media?.base64) throw new ViberStop('image_missing', 'before');
  const name = `workos-autopost-${String(media.sha256 || '').slice(0, 12) || 'image'}.jpg`;
  const query = async () => {
    const out = await android.sh(`content query --uri content://media/external/images/media --where ${shQuote(`_display_name='${name}'`)} --projection _id`, { timeout: 20_000 });
    return (out.match(/_id=(\d+)/) || [])[1] || '';
  };
  let id = await query();
  if (!id) {
    const dir = await mkdtemp(join(tmpdir(), 'workos-viber-'));
    try {
      const local = join(dir, name);
      await writeFile(local, Buffer.from(media.base64, 'base64'));
      const pushed = await android.adb(['push', local, `/sdcard/Pictures/${name}`], { timeout: 60_000 });
      if (pushed.code !== 0) throw new ViberStop('android_error', 'before', 'push');
    } finally { await rm(dir, { recursive: true, force: true }); }
    await android.sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/${name} >/dev/null 2>&1`);
    for (let attempt = 0; attempt < 6 && !id; attempt += 1) { await sleep(1000); id = await query(); }
  }
  if (!id) throw new ViberStop('android_error', 'before', 'media id');
  await android.sh(`pm grant ${VIBER_PACKAGE} ${MEDIA_PERMISSION}`);
  return id;
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

const minuteLabels = ({ hours, minutes }) => [0, 1].map((back) => {
  const total = (hours * 60 + minutes - back + 1440) % 1440;
  const h = Math.floor(total / 60); const m = total % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
});

/**
 * Прокручує список «Share with», доки не знайде рядок із назвою `wanted`. Дві однакові назви на одному екрані — це
 * неоднозначність (пропуск); кінець списку без збігу — `target_not_found`. Прокрутка повільна (без інерції), а
 * перекриття сторінок перевіряється, щоб не проскочити рядок.
 */
async function scrollToRow(android, firstNodes, wanted, guard) {
  let nodes = firstNodes;
  let previous = [];
  let stale = 0;
  let empty = 0;
  for (let page = 0; page < 120; page += 1) {
    guard();
    const rows = nodes.filter((node) => node.id === 'name');
    const hits = rows.filter((node) => looseName(node.text) === wanted);
    if (hits.length > 1) throw new ViberStop('target_ambiguous', 'before');
    if (hits.length === 1) return hits[0];
    const names = rows.map((node) => node.text);
    if (page > 0 && names.join('|') === previous.join('|')) { stale += 1; if (stale >= 4) break; } else stale = 0;
    const list = byId(nodes, 'items_list');
    if (!list) {
      // Порожнє дерево: екран ще анімується. Кілька повторів, далі зупинка без відправки.
      empty += 1;
      if (empty >= 10) throw new ViberStop('send_ui_unavailable', 'before', 'list');
      await sleep(1200);
      nodes = await android.dump();
      continue;
    }
    const height = list.bottom - list.top;
    const x = Math.round((list.left + list.right) / 2);
    const from = list.bottom - 30;
    await android.sh(`input swipe ${x} ${from} ${x} ${from - Math.round(height * 0.6)} 650`);
    await sleep(700);
    previous = names;
    nodes = await android.dump();
    const next = nodes.filter((node) => node.id === 'name').map((node) => node.text);
    // Жоден із попередніх рядків не видно: сторінка проскочила, повертаємось на пів кроку назад.
    if (previous.length && next.length && !next.some((name) => previous.includes(name))) {
      await android.sh(`input swipe ${x} ${list.top + 60} ${x} ${list.top + 60 + Math.round(height * 0.3)} 650`);
      await sleep(700);
      nodes = await android.dump();
    }
  }
  throw new ViberStop('target_not_found', 'before', 'not in the share list');
}

/** Виконує дію й чекає зміни стану; якщо стану немає, повторює дію (до `attempts` разів). */
async function actUntil(android, act, predicate, { attempts = 3, timeout = 8000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act();
    const result = await android.waitFor(predicate, timeout);
    if (result) return result;
  }
  return null;
}

async function share(android, payload, imageId, targetName, guard) {
  const caption = String(payload.message || '');
  await android.key(3);
  await sleep(600);
  // 0x10008000 = NEW_TASK | CLEAR_TASK: без нього відкрита розмова перехоплює намір і вікно вибору чату не з'являється.
  await android.sh(`am start -f 0x10008000 -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM content://media/external/images/media/${imageId} -e android.intent.extra.TEXT ${shQuote(caption)} -p ${VIBER_PACKAGE} --grant-read-uri-permission`);
  const picker = await android.waitFor((nodes) => (byId(nodes, 'items_list') && nodes.some((node) => node.id === 'name') ? nodes : null), 25_000);
  if (!picker) throw new ViberStop('send_ui_unavailable', 'before', 'picker');
  // Viber не піднімає щойно відкритий чат у «RECENT» (порядок за активністю), а ввести кирилицю без буфера обміну
  // неможливо, тож шукаємо рядок із точною назвою прокруткою списку й беремо перший збіг.
  const wanted = looseName(targetName);
  guard();
  const found = await scrollToRow(android, picker.nodes, wanted, guard);
  const rowFor = (nodes) => nodes.find((node) => node.id === 'name' && looseName(node.text) === wanted);
  const isSelected = (nodes, row) => nodes.some((node) => node.id === 'check' && node.checked && Math.abs(node.y - row.y) < 40);
  // Дотики в списку й на кнопках інколи губляться, поки екран оновлюється: довгий дотик і повтор, поки стан не зміниться.
  const selected = await actUntil(android, async () => {
    const nodes = await android.dump();
    const row = rowFor(nodes) || found;
    if (!isSelected(nodes, row)) await android.press(row);
  }, (nodes) => {
    const checked = nodes.filter((node) => node.id === 'check' && node.checked);
    return checked.length === 1 && nodes.some((node) => node.id === 'add_recipients_counter' && node.text.startsWith('1/')) && byId(nodes, 'fab_send') ? nodes : null;
  });
  if (!selected) throw new ViberStop('target_unconfirmed', 'before', 'selection');
  const checkedBox = selected.nodes.find((node) => node.id === 'check' && node.checked);
  const checkedName = selected.nodes.filter((node) => node.id === 'name').find((node) => Math.abs(node.y - checkedBox.y) < 40);
  if (!checkedName || looseName(checkedName.text) !== wanted) throw new ViberStop('target_unconfirmed', 'before', 'wrong row selected');
  guard();
  const preview = await actUntil(android, async () => {
    guard();
    const fab = byId(await android.dump(), 'fab_send');
    if (fab) await android.press(fab);
  }, (nodes) => (byId(nodes, 'btn_send') && byId(nodes, 'custom_cam_preview_media_description') ? nodes : null), { timeout: 10_000 });
  if (!preview) throw new ViberStop('send_ui_unavailable', 'before', 'preview');
  if (caption.trim() && !byId(preview.nodes, 'custom_cam_preview_media_description').text.trim()) throw new ViberStop('send_ui_unavailable', 'before', 'caption empty');
  // Остання точка, де «Зупинити» ще діє: далі повідомлення може піти.
  guard();
  // Із цього моменту повідомлення може піти. Повторний дотик лише якщо вікно перегляду не закрилось за 8 с: так
  // надіслане повідомлення не задвоїться, а загублений дотик не залишить чат без відправки.
  const inPreview = async () => (await android.focusLine()).includes('MediaPreviewActivity');
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt += 1) {
    const send = byId(await android.dump(), 'btn_send');
    if (send) await android.press(send);
    for (let wait = 0; wait < 8 && !sent; wait += 1) {
      await sleep(1000);
      sent = !(await inPreview());
    }
  }
  if (!sent) throw new ViberStop('send_not_confirmed', 'after', 'send button did not respond');
  return caption;
}

async function confirmSent(android, caption, targetName) {
  const conversation = await android.waitFor((nodes) => (conversationState(nodes, targetName).title && byId(nodes, 'send_text') ? nodes : null), 25_000);
  if (!conversation) throw new ViberStop('send_not_confirmed', 'after', 'conversation not shown');
  const opened = conversationState(conversation.nodes, targetName);
  if (!opened.matches) throw new ViberStop('target_unconfirmed', 'after', opened.title.text.slice(0, 80));
  const labels = minuteLabels(await android.clock());
  const prefix = looseName(caption).slice(0, 24);
  await sleep(2500);
  const nodes = await android.dump();
  const bubbles = nodes.filter((node) => node.id === 'textMessageView').sort((a, b) => b.bottom - a.bottom);
  const last = bubbles[0];
  const stamp = last && nodes.filter((node) => node.id === 'timestampView' && node.top >= last.top - 10).sort((a, b) => a.top - b.top)[0];
  const stampText = stamp ? stamp.text.replace(/[\s  ]+/g, ' ').trim() : '';
  const textOk = !prefix || (last && looseName(last.text).startsWith(prefix));
  if (!last || !textOk || !labels.includes(stampText)) throw new ViberStop('send_not_confirmed', 'after', 'new message not found');
  const status = nodes.find((node) => node.id === 'statusView' && node.top >= last.top - 10 && node.top <= last.bottom + 40);
  if (status && await statusLooksFailed(android, status)) throw new ViberStop('send_not_confirmed', 'after', 'message marked as not sent');
}

// ---------------------------------------------------------------- Дії для runner

async function status() {
  const android = await connect();
  await checkEnvironment(android);
  await cleanupIdleImages(android);
  return { ok: true, status: 'ready', reason: null, severity: 'env', detail: '' };
}

async function post(payload, guard) {
  guard();
  lastPostAt = Date.now();
  const android = await connect();
  await checkEnvironment(android);
  guard();
  const imageId = await ensureImage(android, payload.media);
  guard();
  const targetName = await openTarget(android, payload);
  guard();
  await share(android, payload, imageId, targetName, guard);
  await confirmSent(android, String(payload.message || ''), targetName);
  lastPostAt = Date.now();
  return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: targetName };
}

/**
 * @param {'status'|'post'} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{ok:boolean,status:string,reason?:string|null,severity?:string,detail?:string,[key:string]:unknown}>}
 */
export async function runViberAndroid(action, payload = {}, { shouldAbort = () => false } = {}) {
  if (process.platform !== 'linux') return { ok: true, status: 'skipped', reason: 'viber_unsupported_platform', severity: 'env' };
  let timer;
  try {
    // Скасування оператором («Зупинити») діє до відправки: після нього жодного нового кроку.
    const guard = () => { if (shouldAbort()) throw new ViberStop('cancelled', 'before'); };
    const work = action === 'status' ? status() : post(payload, guard);
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new ViberStop('helper_timeout', 'after', 'timeout')), POST_TIMEOUT_MS); });
    return await Promise.race([work, limit]);
  } catch (error) {
    if (error instanceof ViberStop) return { ok: false, status: error.severity === 'env' ? 'blocked' : error.severity === 'after' ? 'failed' : 'skipped', reason: error.reason, severity: error.severity, detail: error.detail };
    return { ok: false, status: 'failed', reason: 'helper_error', severity: 'after', detail: String(error?.message || error).slice(0, 160) };
  } finally { clearTimeout(timer); }
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
