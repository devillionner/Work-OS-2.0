// Здоров'я автопосту (3.18.0): відбиток середовища, пробна відправка (canary) і запобіжник серії.
//  • Відбиток: дистрибутив, сесія, дисплей Waydroid, версії Viber/браузера тощо. Зміна → обов'язкова пробна відправка.
//  • Пробна відправка: перед першою партією платформи за день, після перезапуску runner і після зміни відбитка; не пройшла → партія
//    платформи не стартує, пройшла → йде.
//  • Запобіжник: однаковий збій на двох різних чатах поспіль (або 3 з 5) = збій середовища, а не чатів.
// Стан у <state>/health.json (лише відбиток і час останньої перевірки); нічого в D1.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { stateDir } from './platform/paths.mjs';
import { dirname, join } from 'node:path';

export const PLATFORMS = ['viber', 'whatsapp', 'telegram'];
export const NAMES = { viber: 'Viber', whatsapp: 'WhatsApp', telegram: 'Telegram' };
/** Скільки платформа стоїть на паузі між перевірками (далі DO сам повертає задачу, а runner знову запускає пробну відправку). */
export const RECHECK_MS = 10 * 60_000;
/** Що саме робить пробна відправка платформи й скільки це триває (для «Зараз», трея й картки дня). */
export const CANARY_INFO = {
  viber: { target: 'в My Notes', seconds: 30 },
  telegram: { target: 'у «Збережене»', seconds: 15 },
  whatsapp: { target: 'в чат «Ви»', seconds: 25 },
};
export function canaryTitle(platform) { return `Перевіряю ${NAMES[platform]} перед партією`; }
export function canaryText(platform) {
  const info = CANARY_INFO[platform];
  return `пробна відправка ${info.target} · ~${info.seconds} с`;
}

const kyivDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(ms);
const clockOf = (ms) => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * Коди збою, які в серії виглядають як збій середовища. `before` — до натискання «Надіслати» (задачу безпечно повернути в чергу),
 * `after` — після (повернути не можна: пауза платформи, але сама задача йде звичайним шляхом перевірки відправки).
 */
const SUSPECT = {
  viber: { before: ['blocking_dialog', 'send_ui_unavailable', 'viber_invite_not_opened', 'helper_error', 'android_error', 'adbkeyboard_disabled'], after: ['send_not_confirmed', 'helper_timeout'] },
  telegram: { before: ['telegram_attachment_not_opened', 'telegram_composer_not_found', 'telegram_page_not_ready', 'telegram_chat_not_opened', 'telegram_send_not_clicked', 'telegram_text_mismatch', 'telegram_thread_not_opened'], after: ['send_not_confirmed', 'media_send_not_confirmed', 'helper_timeout'] },
  whatsapp: { before: ['page_not_ready', 'composer_not_found', 'media_preview_not_ready', 'media_caption_not_found', 'media_send_control_not_found', 'media_attach_failed'], after: ['send_not_confirmed', 'media_send_not_confirmed', 'helper_timeout', 'media_send_failed'] },
};

export const suspectKind = (platform, code) => (SUSPECT[platform]?.before.includes(code) ? 'before' : SUSPECT[platform]?.after.includes(code) ? 'after' : '');

/** Людське пояснення збою пробної відправки: що зламалось і що робити (один рядок). */
const HELP = {
  viber_ocr_unavailable: 'У Windows немає мови OCR для кирилиці (ru-RU): Viber Desktop не може перевірити назву чату. Встанови від адміністратора: Add-WindowsCapability -Online -Name "Language.OCR~~~ru-RU~0.0.1.0"',
  viber_desktop_focus_stolen: 'Дії у Viber Desktop забирали активне вікно й перемикали екран. Перенеси вікно Viber на робочий стіл, де ти працюєш',
  viber_desktop_not_running: 'Viber Desktop не запущений',
  viber_desktop_dialog: 'У Viber Desktop відкрито діалог: закрий його',
  viber_desktop_pending: 'Viber Desktop вимкнений у налаштуваннях runner (WORK_OS_VIBER_DESKTOP=0)',
  viber_unknown_window: 'Viber показує невідоме вікно після запуску. Знімок у теці збоїв; закрий вікно в Android («Показати Android»)',
  adbkeyboard_disabled: 'Клавіатура ADBKeyBoard не ввімкнена в Android. Виконай: adb shell ime enable com.android.adbkeyboard/.AdbIME',
  adbkeyboard_missing: 'У Waydroid немає клавіатури ADBKeyBoard. Встанови її: adb install ADBKeyboard.apk',
  viber_invite_not_opened: 'Viber не відкриває чати за запрошенням (лишається на списку чатів). Перевір, що Viber активований, і перезапусти Waydroid',
  blocking_dialog: 'Viber показує екран, який автопост не розпізнає. Знімок у теці збоїв; закрий діалог у Android',
  send_ui_unavailable: 'Екран відправки Viber не такий, як очікує автопост (немає поля підпису чи кнопки). Знімок у теці збоїв',
  send_not_confirmed: 'Відправка не підтвердилась: дотик міг піти повз кнопку. Знімок у теці збоїв',
  viber_not_activated: 'Viber у Waydroid не активований як додатковий пристрій',
  waydroid_not_running: 'Waydroid не запущений: запусти сесію (waydroid session start)',
  android_unreachable: 'Android у Waydroid не відповідає на adb: перезапусти сесію Waydroid',
  android_unauthorized: 'adb не авторизований в Android: відкрий «Показати Android» і дозволь',
  viber_language: 'Мова Android у Waydroid має бути англійською',
  cdp_unavailable: 'Браузер runner не відповідає: відкрий його (меню значка runner) або перезапусти runner',
  cdp_not_configured: 'Браузер runner не підключений',
  telegram_not_authenticated: 'Telegram Web не залогінений: відкрий браузер runner і увійди',
  telegram_account_unbound: 'Акаунт Telegram не прив’язано до браузера: натисни «Прив’язати цей акаунт» у картці Telegram',
  telegram_account_mismatch: 'У браузері відкрито інший акаунт Telegram, не той, що вибрано у Work OS',
  telegram_tab_missing: 'У браузері runner немає вкладки Telegram Web',
  whatsapp_tab_missing: 'У браузері runner немає вкладки WhatsApp Web',
  whatsapp_self_unknown: 'Не вдалося визначити номер акаунта WhatsApp: перезавантаж вкладку WhatsApp Web',
  whatsapp_self_chat_not_opened: 'WhatsApp Web не відкрив чат «Ви»: перезавантаж вкладку або увійди знову',
  page_not_ready: 'WhatsApp Web не готовий: перезавантаж вкладку або увійди знову (QR)',
  composer_not_found: 'WhatsApp Web не показав поле повідомлення',
  media_preview_not_ready: 'WhatsApp Web не відкрив вікно фото',
  media_send_not_confirmed: 'WhatsApp не підтвердив відправку (галочки немає)',
  telegram_page_not_ready: 'Telegram Web не відкривається: сторінка порожня',
  telegram_attachment_not_opened: 'Telegram Web не відкрив вікно фото',
  telegram_composer_not_found: 'Telegram Web не показав поле повідомлення',
};
/** `detail` для `viber_unknown_window` уже містить пояснення з назвою вікна («Viber показує невідоме вікно після запуску: …»). */
export const helpFor = (code, detail = '') => {
  if (code === 'viber_unknown_window' && detail) return String(detail).split(' | пройшло')[0];
  if (code === 'telegram_page_not_ready' && detail) return `Telegram Web не відкривається: ${String(detail).slice(0, 200)}`;
  return HELP[code] || `Пробна відправка не пройшла (код ${code}). Знімок у теці збоїв`;
};

/** Короткий опис змін між двома відбитками: «Viber 6.1 → 6.2; ADBKeyBoard: вимкнена». */
export function describeChange(previous, next) {
  if (!previous || !next) return '';
  const parts = [];
  for (const key of Object.keys({ ...previous, ...next })) {
    // Поле, яке зараз не прочиталось (порожнє чи «недоступний»), зміною не вважається.
    if (isUnreadable(next[key])) continue;
    if (previous[key] !== next[key]) parts.push(`${key}: ${previous[key] || '—'} → ${next[key] || '—'}`);
  }
  return parts.slice(0, 4).join('; ');
}

const isUnreadable = (value) => value === undefined || value === null || value === '' || value === 'недоступний';
/** Порівняння відбитків лише за полями, що прочиталися в обох. */
const stable = (value, other) => JSON.stringify(Object.keys(value || {}).sort().filter((key) => !other || (!isUnreadable(value[key]) && !isUnreadable(other[key]))).map((key) => [key, value[key]]));

/** @param {{file?: string, now?: () => number}} [options] */
export function createHealth({ file = join(stateDir(), 'health.json'), now = () => Date.now() } = {}) {
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')).platforms || {}; } catch { /* першого разу файла немає */ }
  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ platforms: Object.fromEntries(PLATFORMS.map((p) => [p, { fingerprint: saved[p]?.fingerprint ?? null, day: saved[p]?.day ?? '', checkedAt: saved[p]?.checkedAt ?? 0 }])) }));
      renameSync(`${file}.tmp`, file);
    } catch { /* стан необов'язковий */ }
  };
  /** @type {Record<string, any>} */
  const live = {};
  const entry = (platform) => (live[platform] ||= { status: 'unknown', checkedAt: saved[platform]?.checkedAt || 0, text: '', changeText: '', results: [], startChecked: false, forced: false, pausedUntil: 0, reason: '' });

  return {
    /** Чи потрібна пробна відправка зараз і чому. */
    needCheck(platform, fingerprint) {
      const item = entry(platform);
      if (item.forced) return { need: true, why: 'forced' };
      if (item.status === 'paused') return { need: true, why: 'paused' };
      if (!item.startChecked) return { need: true, why: saved[platform]?.fingerprint && fingerprint && stable(saved[platform].fingerprint, fingerprint) !== stable(fingerprint, saved[platform].fingerprint) ? 'changed' : 'restart' };
      if (fingerprint && saved[platform]?.fingerprint && stable(saved[platform].fingerprint, fingerprint) !== stable(fingerprint, saved[platform].fingerprint)) return { need: true, why: 'changed' };
      if (saved[platform]?.day !== kyivDay(now())) return { need: true, why: 'day' };
      return { need: false, why: '' };
    },
    changeText(platform, fingerprint) { return describeChange(saved[platform]?.fingerprint, fingerprint); },
    markChecking(platform, why, changeText = '') {
      const item = entry(platform);
      item.status = 'checking';
      item.changeText = changeText;
      item.text = why === 'changed' && changeText ? `Середовище змінилось: ${changeText}. Перевіряю` : 'Перевіряю середовище';
    },
    markOk(platform, fingerprint) {
      const item = entry(platform);
      item.status = 'ok'; item.checkedAt = now(); item.text = ''; item.changeText = ''; item.forced = false; item.startChecked = true; item.pausedUntil = 0; item.reason = ''; item.results = [];
      saved[platform] = { fingerprint: fingerprint ? { ...fingerprint, ...Object.fromEntries(Object.entries(saved[platform]?.fingerprint || {}).filter(([key]) => isUnreadable(fingerprint[key]))) } : saved[platform]?.fingerprint || null, day: kyivDay(now()), checkedAt: item.checkedAt };
      persist();
    },
    markPaused(platform, { reason, text, until }) {
      const item = entry(platform);
      item.status = 'paused'; item.checkedAt = now(); item.reason = reason; item.text = text; item.pausedUntil = until; item.forced = false; item.startChecked = true;
    },
    /** Перевірка перервалась (скасування, збій самого runner): рядок «Перевіряю…» не має лишатись назавжди. */
    clearChecking(platform) { const item = entry(platform); if (item.status === 'checking') { item.status = 'unknown'; item.text = ''; item.changeText = ''; } },
    /** Власник натиснув «Перевірити й продовжити»: наступна задача спершу проходить пробну відправку. */
    force(platform) { entry(platform).forced = true; },
    isForced(platform) { return entry(platform).forced; },
    /**
     * Результат реальної задачі для запобіжника. Повертає { trip, code, release }: серія однакових збоїв на різних чатах.
     * release — задачу можна повернути в чергу (збій до «Надіслати»).
     */
    noteResult(platform, { ok, code = '', chat = '' }) {
      const item = entry(platform);
      const kind = ok ? '' : suspectKind(platform, code);
      item.results.push({ ok, code: kind ? code : '', chat });
      if (item.results.length > 5) item.results.shift();
      if (!kind) { if (ok) item.results = []; return { trip: false, code, release: false }; }
      const same = item.results.filter((entryItem) => entryItem.code === code);
      const chats = new Set(same.map((entryItem) => entryItem.chat));
      const lastTwo = item.results.slice(-2);
      const consecutive = lastTwo.length === 2 && lastTwo.every((entryItem) => entryItem.code === code) && new Set(lastTwo.map((entryItem) => entryItem.chat)).size === 2;
      const trip = consecutive || (same.length >= 3 && chats.size >= 3);
      return { trip, code, release: trip && kind === 'before' };
    },
    /** Попередній результат серії — той самий код на іншому чаті: другий такий збій поспіль дав би запобіжник серії. */
    seriesPending(platform, code, chat = '') {
      const last = entry(platform).results.at(-1);
      return Boolean(last && last.code === code && last.chat !== chat);
    },
    /** Стан для картки й трея (повідомлення live-каналу). */
    publicState(platform) {
      const item = entry(platform);
      return {
        platform,
        status: item.status,
        checkedAt: item.checkedAt,
        text: item.text,
        reason: item.reason,
        until: item.pausedUntil > now() ? item.pausedUntil : 0,
        line: item.status === 'ok' ? `Перевірено о ${clockOf(item.checkedAt)} · працює`
          : item.status === 'paused' ? `Пауза: ${item.text}`
            : item.status === 'checking' ? (item.changeText ? `Середовище змінилось: ${item.changeText} · перевіряю` : `${canaryTitle(platform)} (${canaryText(platform)})`)
              : '',
      };
    },
    status(platform) { return entry(platform).status; },
  };
}
