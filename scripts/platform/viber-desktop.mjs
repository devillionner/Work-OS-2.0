// Viber Desktop на Windows (3.22.0): автопост у справжні чати через UI Automation, Win32-діалог файла й OCR шапки. Той самий вхід і ті самі коди
// результатів, що в адаптера Android (`runViberAndroid`), тож runner, сервер і картки не змінюються.
//
// Принцип безпеки: UIA НЕ віддає назву відкритого чату, тому ПЕРЕД будь-яким введенням тексту чи вибором фото шапка розмови знімається (лише вікно
// Viber), розпізнається OCR (ru-RU й en-US; української немає) і нечітко порівнюється з назвою цілі (`lib/ocr-name-match.mjs`, поріг ≥ 0.8). Не збіглось
// чи не прочиталось — `target_unconfirmed` без введення. Підтвердження відправки — власне повідомлення з початком підпису в стрічці (UIA віддає текст).
//
// Фокус: дії у вікні Viber не мають забирати активне вікно в людини (Viber може бути на іншому робочому столі, і Windows перемкне екран). Помічник
// `viber-uia.ps1` повідомляє `focusStolen`; після першого такого випадку адаптер ставить Viber на довгу паузу (`viber_desktop_focus_stolen`), а не мучить людину.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { bestOcrMatch, nameSkeleton, observedFromOcr } from '../../lib/ocr-name-match.mjs';
import { saveFailureSnapshot } from '../failure-snapshots.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'windows');
const UIA = join(SCRIPTS, 'viber-uia.ps1');
const VISION = join(SCRIPTS, 'viber-vision.ps1');
const DIALOG = join(SCRIPTS, 'viber-dialog.ps1');
const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

const POST_TIMEOUT_MS = 4 * 60_000;
const VERIFY_TIMEOUT_MS = 3 * 60_000;
const CONFIRM_TEXT_MS = 40_000;
const CONFIRM_PHOTO_MS = 90_000;
const FOCUS_PAUSE_MS = 30 * 60_000;
/** Кнопки діалогів і панелей, які безпечно закривати. «Turn on», «Allow», «Enable», оплата, «Leave and delete», «Report» — ніколи. */
const SAFE_DISMISS = ['got it', 'not now', 'skip', 'maybe later', 'no thanks', 'later', 'close', 'ok', 'cancel', 'dismiss'];
const FORBIDDEN_BUTTON = /(turn on|allow|enable|pay|buy|purchase|subscribe|leave|delete|report|block|remove|clear chat)/i;
const isJoinButton = (name) => /^(join|приєднатися|вступить|присоединиться)/i.test(String(name || ''));

class DesktopStop extends Error {
  constructor(reason, severity = 'before', detail = '', observed = '') {
    super(`${reason}${detail ? `: ${detail}` : ''}`);
    this.reason = reason;
    this.severity = severity;
    this.detail = detail;
    this.observed = observed;
  }
}

let focusStolenAt = 0;
let busy = null;

/** Запуск PowerShell-помічника: один рядок JSON у відповідь, без вікон. */
function ps(file, args, timeout = 40_000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { timeout, windowsHide: true, maxBuffer: 1 << 26 }, (error, stdout) => {
      const line = String(stdout || '').replace(/^﻿/, '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, reason: 'viber_desktop_helper_error', detail: error ? String(error.message).slice(0, 160) : line.slice(0, 160) }); }
    });
  });
}
const uia = (command, extra = [], timeout) => ps(UIA, ['-Command', command, ...extra], timeout);
const vision = (command, extra = [], timeout = 60_000) => ps(VISION, ['-Command', command, ...extra], timeout);
const dialog = (command, extra = [], timeout = 30_000) => ps(DIALOG, ['-Command', command, ...extra], timeout);

/** Результат дії помічника: фокус забрано — запам'ятати для довгої паузи (дія вже виконана, тож задачу доводимо до кінця). */
function noteFocus(result, what) {
  if (result?.focusStolen) { focusStolenAt = Date.now(); console.warn(`Viber Desktop: дія «${what}» забрала активне вікно у людини; Viber піде на паузу.`); }
  return result;
}
const act = async (command, extra, what, timeout) => noteFocus(await uia(command, extra, timeout), what || command);

/** Опитування: умова повертає значення (truthy) — готово. */
async function waitFor(read, ok, timeoutMs, stepMs = 700, guard = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    guard();
    last = await read();
    if (ok(last)) return last;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

// ── Середовище ────────────────────────────────────────────────────────────────

/** Місце Viber.exe для запуску, коли програму закрито. */
function viberExe() {
  const roots = [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
  for (const root of roots) {
    for (const rel of ['Viber\\Viber.exe', 'Programs\\Viber\\Viber.exe']) {
      const file = join(root, rel);
      if (existsSync(file)) return file;
    }
  }
  return '';
}

/** Чи є український чи російський OCR (кирилиця); без нього назви чатів не звіряються й нічого не надсилається. */
async function ocrAvailable() {
  const langs = await vision('langs', [], 20_000);
  const available = Array.isArray(langs.available) ? langs.available : [];
  return available.some((tag) => /^ru/i.test(tag) || /^uk/i.test(tag));
}

/** Стан Viber Desktop без жодних змін у вікні (для картки й перевірки середовища). */
export async function viberDesktopStatus() {
  const status = await uia('status');
  if (!status.ok) return status;
  return status;
}

export async function viberDesktopDismiss(button = 'OK') { return act('dismiss', ['-Button', button], 'dismiss'); }

/** Закриває відомі безпечні діалоги; невідомий — зупинка зі знімком вікна. */
async function clearDialogs(status) {
  let current = status;
  for (let round = 0; round < 4 && current.popups?.length; round += 1) {
    const popup = current.popups[0];
    // Вікно вступу в спільноту, що лишилось від минулої спроби: закриваємо «×» (ніколи не вступаємо тут).
    if ((popup.buttons || []).some(isJoinButton)) {
      await act('close-popup', [], 'close-popup');
      await sleep(700);
      current = await uia('status');
      continue;
    }
    const safe =(popup.buttons || []).find((name) => SAFE_DISMISS.includes(String(name).toLowerCase()) && !FORBIDDEN_BUTTON.test(String(name)));
    if (!safe) {
      await snapshot('viber_unknown_window', `діалог «${popup.title || ''}» з кнопками: ${(popup.buttons || []).join(', ') || 'без кнопок'}`);
      throw new DesktopStop('viber_unknown_window', 'env', `Viber показує невідоме вікно: «${popup.title || ''}» (кнопки: ${(popup.buttons || []).join(', ') || 'немає'})`);
    }
    await act('dismiss', ['-Button', safe], 'dismiss');
    await sleep(700);
    current = await uia('status');
  }
  if (current.popups?.length) throw new DesktopStop('viber_unknown_window', 'env', 'діалог Viber не закривається');
  return current;
}

/** Знімок вікна Viber у теку збоїв (лише вікно Viber, не весь екран). */
async function snapshot(code, detail) {
  try {
    const dir = await mkdtemp(join(tmpdir(), 'workos-viber-shot-'));
    try {
      const file = join(dir, 'screen.png');
      const shot = await vision('shot', ['-Out', file], 40_000);
      const png = shot.ok ? await readFile(file).catch(() => null) : null;
      saveFailureSnapshot({ platform: 'viber', code, png, tree: '', detail });
    } finally { await rm(dir, { recursive: true, force: true }); }
  } catch { /* діагностика не має ламати відповідь */ }
}

/** Готує Viber до задачі: запущено, вікно не згорнуте (відновлюється без активації), без модальних діалогів, OCR є. Повертає те, що треба повернути в `finally`. */
async function prepare(onStep) {
  if (Date.now() - focusStolenAt < FOCUS_PAUSE_MS) {
    throw new DesktopStop('viber_desktop_focus_stolen', 'env', 'дії у Viber забирали активне вікно; пауза, щоб не заважати. Перенеси вікно Viber на робочий стіл, де ти працюєш, чи поверни автопост кнопкою');
  }
  if (!(await ocrAvailable())) throw new DesktopStop('viber_ocr_unavailable', 'env', 'у Windows немає мови OCR для кирилиці (Language.OCR~~~ru-RU~0.0.1.0, потрібен адміністратор)');
  let status = await uia('status');
  if (status.reason === 'viber_desktop_not_running') {
    const exe = viberExe();
    if (!exe) throw new DesktopStop('viber_desktop_not_running', 'env', 'Viber Desktop не запущено, і Viber.exe не знайдено');
    onStep?.('env', 'запускаю Viber Desktop');
    spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    status = await waitFor(() => uia('status'), (value) => value.ok && value.running, 60_000, 2000);
    if (!status) throw new DesktopStop('viber_desktop_not_running', 'env', 'Viber Desktop не запустився за хвилину');
    await sleep(4000);
    status = await uia('status');
  }
  if (!status.ok) throw new DesktopStop(status.reason === 'viber_desktop_window_missing' ? 'viber_desktop_window_missing' : 'viber_desktop_helper_error', 'env', status.detail || '');
  const state = await uia('window', ['-Button', 'state']);
  let restored = false;
  if (state.iconic) {
    await uia('window', ['-Button', 'restore']);
    restored = true;
    await sleep(900);
  }
  status = await clearDialogs(await uia('status'));
  return { restored };
}

async function finish(context) {
  if (context?.restored) await uia('window', ['-Button', 'minimize']).catch(() => {});
}

// ── Геометрія, шапка, OCR ─────────────────────────────────────────────────────

const rectArg = (r) => `${r.x},${r.y},${r.w},${r.h}`;

/** Геометрія вікна (стрічка, шапка, поле, рядки списку); чекає, поки дерево UIA віддасть розмову. */
async function geometry({ needConversation = false, timeoutMs = 20_000, guard } = {}) {
  const found = await waitFor(() => uia('geometry'), (g) => g.ok && (!needConversation || (g.conversationOpen && g.header)), timeoutMs, 900, guard);
  if (!found) throw new DesktopStop('viber_unknown_window', needConversation ? 'before' : 'env', needConversation ? 'розмова не з\'явилась у вікні Viber' : 'вікно Viber не віддає геометрію');
  return found;
}

/** Назва відкритої розмови за OCR шапки. */
async function readHeader(expected, guard, timeoutMs = 20_000) {
  const g = await geometry({ needConversation: true, guard, timeoutMs });
  if (g.window?.iconic) throw new DesktopStop('viber_desktop_minimized', 'env', 'вікно Viber згорнуте');
  const out = await vision('ocr', ['-Rects', rectArg(g.header), '-Scale', '3']);
  if (!out.ok) {
    if (out.reason === 'viber_ocr_unavailable') throw new DesktopStop('viber_ocr_unavailable', 'env', out.detail || '');
    throw new DesktopStop('viber_desktop_helper_error', 'env', `OCR шапки: ${out.reason || out.detail || ''}`);
  }
  const texts = out.results?.[0]?.texts || [];
  const match = bestOcrMatch(expected, texts, { lines: 1 });
  return { ...match, observed: match.observed || observedFromOcr(texts, 1), geometry: g };
}

/** Шапка мусить збігатися з ціллю, інакше нічого не вводимо. */
async function verifyHeader(expected, guard) {
  const header = await readHeader(expected, guard);
  if (!header.matched) {
    await snapshot('target_unconfirmed', `очікувалось «${expected}», OCR шапки: «${header.observed}» (схожість ${header.score})`);
    throw new DesktopStop('target_unconfirmed', 'before', `шапка розмови «${header.observed || '?'}» не збіглась із «${expected}» (схожість ${header.score}, поріг 0.8)`, header.observed);
  }
  return header;
}

/** Рядок пошуку з назви чату: без емодзі й прапорів, хвостів «в Viber», коротше за 40 символів. */
function searchQuery(name) {
  const clean = String(name || '')
    .replace(/[\s\-–—([]*(?:(?:в|у|in)\s+)?viber[)\]]*\s*$/iu, '')
    .replace(/[^\p{L}\p{N}\s'’\-.&+]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return clean.slice(0, 40).trim();
}

/** Код запрошення спільноти (`g2`) з посилання invite.viber.com; інші види посилань Desktop так не відкриває. */
function inviteData(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.hostname.toLowerCase() !== 'invite.viber.com') return '';
    const data = parsed.searchParams.get('g2') || '';
    return /^[/+A-Za-z0-9=_-]{6,}$/.test(data) ? data : '';
  } catch { return ''; }
}

/** Рядки тексту в середині вікна (діалог Viber): тіло діалогу UIA не віддає, тож читаємо OCR; кожен рядок окремо. */
async function centerLines() {
  const g = await uia('geometry');
  const w = g.window;
  if (!g.ok || !w) return [];
  const box = { x: w.clientX + Math.max(0, Math.floor(w.clientW / 2) - 320), y: w.clientY + Math.max(0, Math.floor(w.clientH / 2) - 220), w: Math.min(640, w.clientW), h: 440 };
  const out = await vision('ocr', ['-Rects', rectArg(box), '-Scale', '2'], 40_000);
  return (out.ok ? out.results?.[0]?.texts || [] : []).flatMap((t) => String(t?.text || '').split(/\r?\n/).filter(Boolean).map((line) => ({ ...t, text: line })));
}
const centerText = async () => (await centerLines()).map((t) => t.text).join(' ');

/**
 * Відкриття чату — ЛИШЕ за запрошенням, як на Android (3.22.4, рішення власника: пошук у списку не знаходить тихих груп, забанених і ще не
 * приєднаних чатів і лише плутає). Повертає шапку, що збіглась; інакше зупинка з причиною. Відмови Viber — це стан чату:
 * «Unable to join … blocked» — бан, «Inactive link» — чату немає. Ще не приєднаний чат Viber Desktop показує діалогом (назва, учасники, опис,
 * «Join Community»; назву UIA не віддає): тиснемо «Join Community» лише коли назва в діалозі за OCR збіглась із ціллю, інакше закриваємо «×».
 */
async function openByInvite(name, url, guard, onStep) {
  const data = inviteData(url);
  if (!data) {
    if (/^https:\/\/invite\.viber\.com\//i.test(String(url || '').trim())) throw new DesktopStop('viber_not_joined', 'before', 'старе посилання (g=) Viber Desktop не відкриває: потрібне посилання-запрошення з g2=');
    throw new DesktopStop('invalid_viber_link', 'before', 'у чату немає посилання-запрошення invite.viber.com');
  }
  onStep?.('open', 'відкриваю чат за запрошенням');
  const opened = await act('open-link', ['-TextBase64', b64(`viber://community_invite?data=${encodeURIComponent(data)}`)], 'open-link');
  if (!opened.ok) throw new DesktopStop('viber_invite_not_opened', 'before', `запрошення не передалось у Viber: ${opened.reason || ''}`);
  let joinTried = false;
  let mismatched = 0;
  let observed = '';
  let openedAt = Date.now();
  let deadline = openedAt + 25_000;
  while (Date.now() < deadline) {
    guard();
    const status = await uia('status');
    const popup = status.popups?.[0];
    if (popup) {
      const title = String(popup.title || '');
      const buttons = popup.buttons || [];
      const join = buttons.find(isJoinButton);
      if (join) {
        if (joinTried) { await sleep(1200); continue; }
        // Довга назва у вікні вступу переноситься на 2–3 рядки («Отдам-Продам-Куплю. Сдам-» / «Сниму_жильё»): пробуємо й склеєні сусідні рядки.
        const lines = await centerLines();
        const candidates = [...lines];
        for (let i = 0; i < lines.length; i += 1) {
          for (let span = 2; span <= 3 && i + span <= lines.length; span += 1) {
            const part = lines.slice(i, i + span);
            if (part.some((t) => t.lang !== part[0].lang || t.inverted !== part[0].inverted)) continue;
            candidates.push({ ...part[0], text: part.map((t) => t.text).join(' ') }, { ...part[0], text: part.map((t) => t.text).join('') });
          }
        }
        const match = bestOcrMatch(name, candidates, { lines: 1 });
        if (!match.matched) {
          await snapshot('target_unconfirmed', `вікно вступу: «${match.observed}», очікувалось «${name}»`);
          await act('close-popup', [], 'close-popup').catch(() => {});
          throw new DesktopStop('target_unconfirmed', 'before', `вікно вступу показує «${match.observed || '?'}», а не «${name}»`, match.observed);
        }
        onStep?.('open', 'вступаю в спільноту');
        joinTried = true;
        const clicked = await act('dismiss', ['-Button', join], 'join');
        if (!clicked.ok) throw new DesktopStop('viber_not_joined', 'before', 'кнопка «Join Community» не натиснулась');
        // Після вступу розмова відкривається не одразу: даємо ще 25 с від натискання, і попередній чат у шапці вже не рахується.
        openedAt = Date.now();
        deadline = openedAt + 25_000;
        mismatched = 0;
        await sleep(2500);
        continue;
      }
      if (/unable to join|не вдалося приєднатися|не удалось присоединиться/i.test(title)) {
        const body = await centerText();
        await act('dismiss', ['-Button', buttons.find((b) => /close|ok/i.test(b)) || 'Close'], 'dismiss').catch(() => {});
        if (/block|заблок/i.test(body)) throw new DesktopStop('viber_banned', 'before', 'Viber: «Unable to join» — вас заблоковано в цій спільноті');
        throw new DesktopStop('viber_not_joined', 'before', `Viber: «${title}»${body ? ` — ${body.slice(0, 120)}` : ''}`);
      }
      if (/inactive link|invalid link|неактивн|недійсн/i.test(title)) {
        await act('dismiss', ['-Button', buttons[0] || 'OK'], 'dismiss').catch(() => {});
        throw new DesktopStop('viber_chat_missing', 'before', `Viber: «${title}» — запрошення більше не діє`);
      }
      await snapshot('viber_not_joined', `після запрошення діалог «${title}» (кнопки: ${buttons.join(', ')})`);
      const safe = buttons.find((b) => SAFE_DISMISS.includes(String(b).toLowerCase()) && !FORBIDDEN_BUTTON.test(String(b)));
      if (safe) await act('dismiss', ['-Button', safe], 'dismiss').catch(() => {});
      else await act('close-popup', [], 'close-popup').catch(() => {});
      throw new DesktopStop('viber_not_joined', 'before', `після запрошення Viber показав «${title}» (кнопки: ${buttons.join(', ') || 'немає'})`);
    }
    if (status.conversationOpen) {
      const header = await readHeader(name, guard, 4_000).catch(() => null);
      if (header?.matched) return header;
      // Перші секунди ще видно попередній чат; стійко інша назва після цього — запрошення веде в чат з іншою назвою (дія «оновити назву»).
      if (header && Date.now() - openedAt > 6_000) { mismatched += 1; observed = header.observed || observed; }
      if (mismatched >= 3) {
        await snapshot('target_unconfirmed', `за запрошенням відкрився «${observed}», очікувався «${name}»`);
        throw new DesktopStop('target_unconfirmed', 'before', `за запрошенням відкрився чат «${observed || '?'}», а не «${name}»`, observed);
      }
    }
    await sleep(1200);
  }
  if (joinTried) throw new DesktopStop('viber_not_joined', 'before', 'після «Join Community» чат не відкрився');
  throw new DesktopStop('viber_invite_not_opened', 'before', 'за 25 с після запрошення Viber не показав ні чат, ні відмову');
}

/** Відкриває потрібний чат: уже відкритий (шапка збіглась) → лише за запрошенням. Пошук у списку — тільки для пробної відправки в «My Notes». */
async function openChat(name, guard, onStep, url = '', { search = false } = {}) {
  const current = await readHeader(name, guard, 6_000).catch(() => null);
  if (current?.matched) return current;
  if (!search) return openByInvite(name, url, guard, onStep);
  const query = searchQuery(name);
  if (query.length < 3) throw new DesktopStop('target_unconfirmed', 'before', 'назва чату надто коротка для пошуку', current?.observed || '');
  onStep?.('open', 'шукаю чат у списку Viber Desktop');
  const set = await act('search', ['-TextBase64', b64(query)], 'search');
  if (!set.ok) throw new DesktopStop('viber_unknown_window', 'before', `пошук у Viber: ${set.reason || 'поле пошуку недоступне'}`);
  try {
    await sleep(1200);
    const found = await waitFor(() => uia('geometry'), (g) => g.ok && g.searchValue === query && g.rows?.length > 0, 14_000, 900, guard);
    if (!found) throw new DesktopStop('viber_not_joined', 'before', `чату «${name}» немає у списку Viber Desktop (пошук «${query}»)`);
    const rects = found.rows.map((r) => `${r.x + 66},${r.y + 4},${Math.max(40, r.w - 66 - 62)},56`).join(';');
    const ocr = await vision('ocr', ['-Rects', rects, '-Scale', '3']);
    if (!ocr.ok) throw new DesktopStop('viber_desktop_helper_error', 'env', `OCR списку: ${ocr.reason || ocr.detail || ''}`);
    const scored = ocr.results.map((entry, index) => ({ index, y: found.rows[index].y, ...bestOcrMatch(name, entry.texts, { lines: 1 }) })).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (!best?.matched) throw new DesktopStop('viber_not_joined', 'before', `серед результатів пошуку «${query}» немає чату з назвою «${name}» (найближчий: «${best?.observed || '—'}», схожість ${best?.score ?? 0})`, best?.observed || '');
    if (second && second.score >= 0.8 && best.score - second.score < 0.1) throw new DesktopStop('target_unconfirmed', 'before', `серед результатів пошуку «${query}» два схожих чати: «${best.observed}» і «${second.observed}»`, best.observed);
    onStep?.('open', 'відкриваю чат');
    const opened = await act('open-row', ['-Index', String(best.index), '-Y', String(best.y)], 'open-row');
    if (!opened.ok) throw new DesktopStop('viber_unknown_window', 'before', `відкриття чату: ${opened.reason || ''}`);
  } finally {
    await act('search-clear', [], 'search-clear').catch(() => {});
  }
  await sleep(1500);
  return verifyHeader(name, guard);
}

// ── Повідомлення в стрічці ────────────────────────────────────────────────────


/** Тексти повідомлень, видимих у стрічці (нижній край: спершу «до кінця»). */
async function feed({ bottom = true } = {}) {
  if (bottom) await act('scroll-bottom', [], 'scroll-bottom').catch(() => {});
  const out = await uia('messages');
  return out.ok ? out.messages || [] : [];
}


// Порівняння за повним текстом (скелет перших 120 символів), а не за першими словами: однакові початки («Work OS: пробна відправка…»,
// те саме оголошення вчора) давали хибне «не підтверджено» (3.22.2, 2026-11-26: фото пішло, а лічильник копій у видимій стрічці не зріс).
const fullKey = (text) => nameSkeleton(String(text || '').slice(0, 400)).slice(0, 120);
/** Стан стрічки щодо підпису: чи найновіше (найнижче) повідомлення — наше, і скільки повних збігів видно. */
function feedState(messages, caption) {
  const key = fullKey(caption);
  const last = messages.reduce((best, m) => (!best || m.y > best.y ? m : best), null);
  return { lastMatch: Boolean(last && fullKey(last.text) === key), count: messages.filter((m) => fullKey(m.text) === key).length };
}

/** Підтвердження: найновіше повідомлення стрічки — наш підпис, і воно нове (до відправки найновішим був інший текст, або копій стало більше). */
async function confirmOwn(caption, before, timeoutMs) {
  if (fullKey(caption).length < 6) throw new DesktopStop('send_not_confirmed', 'after', 'підпис надто короткий, щоб знайти його в стрічці');
  const found = await waitFor(async () => feedState(await feed(), caption), (s) => s.lastMatch && (!before.lastMatch || s.count > before.count), timeoutMs, 2500);
  if (!found) throw new DesktopStop('send_not_confirmed', 'after', `найновіше повідомлення в чаті не стало нашим «${String(caption).slice(0, 30)}»`);
}

// ── Відправка ─────────────────────────────────────────────────────────────────

async function writeImage(media) {
  if (!media?.base64) throw new DesktopStop('image_missing', 'before');
  const dir = await mkdtemp(join(tmpdir(), 'workos-viber-'));
  const file = join(dir, `workos-autopost-${String(media.sha256 || 'image').slice(0, 12)}.jpg`);
  await writeFile(file, Buffer.from(media.base64, 'base64'));
  return { dir, file };
}

/** Перегляд фото: назва отримувача видна на екрані (UIA її не віддає). Читається — звіряємо; не читається — покладаємось на перевірку шапки до вибору файла. */
async function verifyPreviewTarget(name) {
  const g = await uia('geometry');
  const w = g.window;
  if (!g.ok || !w) return;
  const strip = { x: w.clientX, y: w.clientY, w: Math.min(900, w.clientW), h: 110 };
  const out = await vision('ocr', ['-Rects', rectArg(strip), '-Scale', '3'], 40_000);
  const texts = out.ok ? out.results?.[0]?.texts || [] : [];
  const match = bestOcrMatch(name, texts, { lines: 1 });
  // Прочитано впевнено інше ім'я — це не наш чат: закриваємо перегляд без відправки. Нечитабельно — довіряємо шапці, перевіреній секунди тому.
  if (!match.matched && match.observed.length >= 4 && match.score < 0.5) {
    await act('preview-close', [], 'preview-close').catch(() => {});
    throw new DesktopStop('target_unconfirmed', 'before', `у перегляді фото отримувач «${match.observed}», очікувався «${name}»`, match.observed);
  }
}

async function sendPhoto(name, caption, media, guard, step) {
  const image = await writeImage(media);
  try {
    step('photo', 'відкриваю вибір файла');
    const clicked = await actInConversation('attach', []);
    if (!clicked.ok) throw new DesktopStop('send_ui_unavailable', 'before', `кнопка вкладення: ${clicked.reason || ''}`);
    const dlg = await dialog('find', ['-WaitSeconds', '10'], 20_000);
    if (!dlg.found) throw new DesktopStop('send_ui_unavailable', 'before', 'діалог «Send a file» не відкрився');
    guard();
    const picked = await dialog('pick', ['-Path', image.file], 20_000);
    if (!picked.ok) throw new DesktopStop('send_ui_unavailable', 'before', `вибір файла: ${picked.reason || ''}`);
    const preview = await waitFor(() => uia('preview'), (p) => p.ok && p.previewOpen, 20_000, 700, guard);
    if (!preview) {
      await dialog('cancel', [], 10_000).catch(() => {});
      throw new DesktopStop('send_ui_unavailable', 'before', 'перегляд фото не відкрився');
    }
    step('caption', 'вписую підпис');
    const set = await actInConversation('preview-caption', ['-TextBase64', b64(caption)], 60_000);
    if (!set.ok) {
      await act('preview-close', [], 'preview-close').catch(() => {});
      throw new DesktopStop('send_ui_unavailable', 'before', 'підпис у перегляді не записався');
    }
    await verifyPreviewTarget(name);
    guard();
    step('send', 'надсилаю');
    return { sentAt: Date.now(), send: await act('preview-send', ['-ExpectBase64', b64(caption)], 'preview-send', 40_000) };
  } finally { await rm(image.dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Дія, що чекає відкриту розмову: дерево UIA інколи на мить не віддає її після попередньої дії, тож ще дві спроби з паузою. */
async function actInConversation(command, extra, timeout) {
  let out = await act(command, extra, command, timeout);
  for (let i = 0; i < 2 && !out.ok && (out.reason === 'viber_desktop_no_conversation' || out.reason === 'viber_desktop_no_preview'); i += 1) {
    await sleep(1500);
    out = await act(command, extra, command, timeout);
  }
  return out;
}

async function sendText(caption) {
  const set = await actInConversation('set-text', ['-TextBase64', b64(caption)], 60_000);
  if (!set.ok) throw new DesktopStop('send_ui_unavailable', 'before', `поле повідомлення: ${set.reason || 'текст не записався'}`);
  return { sentAt: Date.now(), send: await act('send', ['-ExpectBase64', b64(caption)], 'send', 40_000) };
}

async function post(payload, guard, step, state) {
  const name = String(payload.expectedName || (payload.testTarget === 'my_notes' ? 'My Notes' : ''));
  const caption = String(payload.message || '');
  if (!name) throw new DesktopStop('target_unconfirmed', 'before', 'немає назви чату');
  step('env', 'перевіряю Viber Desktop');
  state.context = await prepare(step);
  guard();
  step('open', 'відкриваю чат');
  const opened = await openChat(name, guard, step, payload.testTarget ? '' : payload.url, { search: Boolean(payload.testTarget) });
  guard();
  if (payload.openOnly) return { ok: true, status: 'checked', reason: null, severity: 'before', observedTarget: opened.observed };
  // Остання перевірка шапки безпосередньо перед введенням (поки відкривали, чат міг змінитись).
  await verifyHeader(name, guard);
  const before = feedState(await feed(), caption);
  guard();
  const textOnly = payload.textOnly === true || !payload.media;
  const result = textOnly ? await sendText(caption) : await sendPhoto(name, caption, payload.media, guard, step);
  state.sentAt = result.sentAt;
  state.sendPressed = true;
  if (!result.send.ok) {
    // Помічник не підтвердив очищення поля: повідомлення могло піти. Далі вирішує підтвердження за стрічкою.
    if (result.send.reason === 'composer_mismatch' || result.send.reason === 'caption_mismatch') { state.sendPressed = false; throw new DesktopStop('send_ui_unavailable', 'before', `поле змінилось: ${result.send.reason}`); }
  }
  step('confirm', 'чекаю повідомлення в стрічці');
  await confirmOwn(caption, before, textOnly ? CONFIRM_TEXT_MS : CONFIRM_PHOTO_MS);
  return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: opened.observed || name, sentAt: Math.floor(result.sentAt / 1000) };
}

/** Режим перевірки: нічого не надсилає. Часу повідомлень UIA не віддає, а те саме оголошення могло вийти тут учора, тому «відправлено» —
 *  лише коли наш текст — найновіше повідомлення чату; інакше «не вдалося визначити» (а не «немає», щоб не було повторної відправки й дубля). */
async function verify(payload, guard, step, state) {
  const name = String(payload.expectedName || '');
  const caption = String(payload.message || '');
  step('env', 'перевіряю Viber Desktop');
  state.context = await prepare(step);
  step('open', 'відкриваю чат');
  const opened = await openChat(name, guard, step, payload.testTarget ? '' : payload.url, { search: Boolean(payload.testTarget) });
  if (fullKey(caption).length < 6) throw new DesktopStop('message_not_found', 'before', 'підпис порожній');
  step('confirm', 'шукаю повідомлення в чаті');
  guard();
  const now = feedState(await feed(), caption);
  if (now.lastMatch) return { ok: true, status: 'sent', reason: null, severity: 'after', observedTarget: opened.observed || name, timings: 'перевірено, повідомлення є в чаті' };
  throw new DesktopStop('verify_inconclusive', 'before', now.count ? 'такий текст є в стрічці, але не найновішим повідомленням: не видно, чи він сьогоднішній' : 'наш текст не найновіше повідомлення в чаті');
}

/**
 * @param {'status'|'post'|'verify'} action
 * @param {Record<string, unknown>} payload
 */
export async function runViberDesktop(action, payload = {}, { shouldAbort = () => false, onStep = () => {} } = {}) {
  if (action === 'status') {
    if (busy) return { ok: true, status: 'busy', reason: null, severity: 'env', detail: `надсилаю в «${busy}»` };
    if (Date.now() - focusStolenAt < FOCUS_PAUSE_MS) return { ok: false, status: 'blocked', reason: 'viber_desktop_focus_stolen', severity: 'env', detail: 'дії у Viber забирали активне вікно у людини' };
    const status = await uia('status');
    if (status.reason === 'viber_desktop_not_running') return { ok: false, status: 'blocked', reason: 'viber_desktop_not_running', severity: 'env', detail: '' };
    if (!status.ok) return { ok: false, status: 'blocked', reason: 'viber_desktop_window_missing', severity: 'env', detail: status.detail || status.reason || '' };
    if (!(await ocrAvailable())) return { ok: false, status: 'blocked', reason: 'viber_ocr_unavailable', severity: 'env', detail: 'немає мови OCR для кирилиці' };
    if (status.popups?.length) return { ok: false, status: 'blocked', reason: 'viber_desktop_dialog', severity: 'env', detail: `діалог: ${status.popups[0].title || ''}` };
    return { ok: true, status: 'ready', reason: null, severity: 'env', detail: '' };
  }
  if (busy) return { ok: false, status: 'blocked', reason: 'helper_busy', severity: 'env', detail: `адаптер зайнятий: ${busy}` };
  busy = String(payload.expectedName || 'чат');
  const state = { context: null, sendPressed: false, sentAt: 0 };
  const startedAt = Date.now();
  const guard = () => { if (!state.sendPressed && shouldAbort()) throw new DesktopStop('cancelled', 'before'); };
  const step = (id, text) => onStep(id, text);
  let timer;
  try {
    const work = action === 'verify' ? verify(payload, guard, step, state) : post(payload, guard, step, state);
    work.catch(() => {});
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(state.sendPressed
          ? new DesktopStop('helper_timeout', 'after', `задача не вклалась у ${Math.round(POST_TIMEOUT_MS / 1000)} с`)
          : new DesktopStop('viber_task_timeout', 'before', `задача не вклалась у ${Math.round((action === 'verify' ? VERIFY_TIMEOUT_MS : POST_TIMEOUT_MS) / 1000)} с`));
      }, action === 'verify' ? VERIFY_TIMEOUT_MS : POST_TIMEOUT_MS);
    });
    const result = await Promise.race([work, limit]);
    return { ...result, timings: result.timings || `${Math.round((Date.now() - startedAt) / 1000)} с` };
  } catch (error) {
    if (error instanceof DesktopStop) {
      const spent = Math.round((Date.now() - startedAt) / 1000);
      return {
        ok: false,
        status: error.severity === 'env' ? 'blocked' : error.severity === 'after' ? 'failed' : 'skipped',
        reason: error.reason,
        severity: error.severity,
        detail: `${error.detail}${error.reason === 'cancelled' ? '' : ` | пройшло ${spent} с`}`.trim(),
        ...(error.observed ? { observedTarget: error.observed } : {}),
        ...(state.sentAt ? { sentAt: Math.floor(state.sentAt / 1000) } : {}),
      };
    }
    return { ok: false, status: 'failed', reason: 'helper_error', severity: state.sendPressed ? 'after' : 'before', detail: String(error?.message || error).slice(0, 160) };
  } finally {
    clearTimeout(timer);
    await finish(state.context).catch(() => {});
    busy = null;
  }
}

/** Відбиток середовища для перевірки «що змінилось»: версія Viber Desktop, мова OCR, збірка Windows. Нічого не чіпає у вікні. */
export async function viberDesktopFingerprint() {
  if (busy) return null;
  const info = await uia('info');
  if (!info.ok) return null;
  const langs = await vision('langs', [], 20_000);
  return { os: info.windows || 'Windows', viber: info.version || 'невідомо', ocr: (langs.available || []).filter((tag) => /^(ru|uk)/i.test(tag)).join(',') || 'немає' };
}
