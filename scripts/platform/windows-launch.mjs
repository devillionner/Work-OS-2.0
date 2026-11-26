// Запуск runner на Windows (3.21.0): замінює scripts/whatsapp-runner.sh. Без bash, без curl, без прав адміністратора.
//   node scripts/platform/windows-launch.mjs                запустити (єдиний екземпляр), підняти браузер runner і сам runner;
//   node scripts/platform/windows-launch.mjs --close-browser  коректно закрити браузер runner (CDP Browser.close), решта профілю лишається;
// Браузер — Edge (чи Chrome) з окремим профілем %LOCALAPPDATA%\WorkOS\browser, портом налагодження на 127.0.0.1 і прапорцями проти гальмування
// прихованих вкладок; без вікна (`--headless=new`, UA без «Headless»), коли власник уже увійшов у WhatsApp і Telegram і сховав вікно.
// Режим: WORK_OS_RUNNER_HEADLESS=1|0, інакше файл `state\runner-browser-mode` («headless» чи «window»; його пише трей), інакше вікно
// (перший вхід: QR-код WhatsApp і Telegram).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserProfileDir, runnerEnvFile, stateDir } from './paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_ENTRY = join(HERE, '..', 'chat-discovery-runner.mjs');
const DEFAULT_URL = 'https://work-os-2-staging.devillionner.workers.dev';
const ENV_KEYS = new Set(['WORK_OS_BROWSER', 'WORK_OS_BROWSER_PROFILE', 'WORK_OS_URL', 'WORK_OS_EXECUTOR_TOKEN', 'WORK_OS_RUNNER_HEADLESS', 'WORK_OS_CDP_PORT', 'WORK_OS_VIBER_DESKTOP']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.log(`[${new Date().toLocaleTimeString('uk-UA')}] ${line}`);

/** Налаштування, які записав інсталятор (runner.env); змінні середовища сильніші. */
export function loadRunnerEnv(file = runnerEnvFile()) {
  let text = '';
  try { text = readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !ENV_KEYS.has(match[1]) || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

const port = () => Number(process.env.WORK_OS_CDP_PORT) || 9222;
const cdpBase = () => `http://127.0.0.1:${port()}`;
const profile = () => process.env.WORK_OS_BROWSER_PROFILE || browserProfileDir();
const browserFile = () => join(stateDir(), 'browser.json');
const modeFile = () => join(stateDir(), 'runner-browser-mode');
const lockFile = () => join(stateDir(), 'runner.lock');

async function cdpReady() {
  try { return (await fetch(`${cdpBase()}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/** Лише один runner одночасно: автозапуск, посилання workos-runner:// і ручний запуск не дублюються. */
function acquireLock() {
  mkdirSync(stateDir(), { recursive: true });
  try {
    const held = JSON.parse(readFileSync(lockFile(), 'utf8'));
    // Запис старший за час запуску системи — залишок до перезавантаження: pid міг дістатися чужому процесу.
    const afterBoot = Number(held.startedAt) > Date.now() - uptime() * 1000;
    if (afterBoot && pidAlive(Number(held.pid)) && Number(held.pid) !== process.pid) return false;
  } catch { /* немає замка або він пошкоджений */ }
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  process.on('exit', () => { try { unlinkSync(lockFile()); } catch { /* уже немає */ } });
  return true;
}

function findBrowser() {
  const given = process.env.WORK_OS_BROWSER;
  if (given && existsSync(given)) return given;
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const names = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']];
  for (const name of names) for (const root of roots) { const candidate = join(root, ...name); if (existsSync(candidate)) return candidate; }
  return '';
}

/** Мажорна версія браузера за текою `Application\<версія>`: `msedge.exe --version` на Windows нічого не друкує. */
function majorVersion(exe) {
  try {
    const versions = readdirSync(dirname(exe)).filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name)).map((name) => Number(name.split('.')[0]));
    if (versions.length) return Math.max(...versions);
  } catch { /* теки немає */ }
  return 130;
}

function userAgent(exe) {
  const major = majorVersion(exe);
  const edge = /msedge/i.test(exe) ? ` Edg/${major}.0.0.0` : '';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${edge}`;
}

function wantHeadless() {
  const forced = String(process.env.WORK_OS_RUNNER_HEADLESS || '').toLowerCase();
  if (['1', 'true', 'yes'].includes(forced)) return true;
  if (['0', 'false', 'no'].includes(forced)) return false;
  try { return readFileSync(modeFile(), 'utf8').trim() === 'headless'; } catch { return false; }
}

async function waitFor(check, seconds) {
  for (let index = 0; index < seconds; index += 1) { if (await check()) return true; await sleep(1000); }
  return false;
}

async function ensureBrowser() {
  if (await cdpReady()) { log(`Браузер на порту ${port()} уже відповідає.`); return true; }
  const exe = findBrowser();
  if (!exe) { log('Не знайдено Edge чи Chrome. Вкажіть WORK_OS_BROWSER у runner.env.'); return false; }
  const url = (process.env.WORK_OS_URL || DEFAULT_URL).replace(/\/$/, '');
  // Після входу в систему мережа з'являється не одразу.
  await waitFor(async () => { try { return (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) })).status < 500; } catch { return false; } }, 60);
  mkdirSync(profile(), { recursive: true });
  const headless = wantHeadless();
  const flags = [
    `--remote-debugging-port=${port()}`, `--user-data-dir=${profile()}`,
    // Прапорці проти гальмування прихованих вікон: автопост працює, поки власник дивиться відео на весь екран в іншому вікні.
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--mute-audio', '--hide-crash-restore-bubble',
  ];
  // Вкладка Work OS потрібна лише коли токен не записано в runner.env: тоді runner читає його зі сторінки Work OS у цьому браузері.
  const tabs = [...(process.env.WORK_OS_EXECUTOR_TOKEN ? [] : [`${url}/`]), 'https://web.whatsapp.com/', 'https://web.telegram.org/a/'];
  if (headless) flags.push('--headless=new', `--user-agent=${userAgent(exe)}`, '--window-size=1400,900');
  log(`Відкриваю ${exe} ${headless ? 'без вікна' : 'з вікном'} (окремий профіль: ${profile()})…`);
  // Без вікна браузер приймає в аргументах лише одну адресу: решта вкладок відкривається через CDP, коли порт готовий.
  const child = spawn(exe, [...flags, headless ? 'about:blank' : tabs[0]], { detached: true, stdio: 'ignore', windowsHide: headless });
  child.on('error', (error) => log(`Браузер не запустився: ${error.message}`));
  child.unref();
  if (!await waitFor(cdpReady, 40)) { log(`Браузер не відкрив порт ${port()}. Якщо він уже був запущений без нього — закрийте його й повторіть.`); return false; }
  try { writeFileSync(browserFile(), JSON.stringify({ pid: child.pid, headless, profile: profile(), port: port(), startedAt: Date.now() })); } catch { /* необов'язково */ }
  for (const extra of headless ? tabs : tabs.slice(1)) {
    try { await fetch(`${cdpBase()}/json/new?${extra}`, { method: 'PUT', signal: AbortSignal.timeout(5000) }); } catch { /* самолікування вкладок підніме */ }
  }
  return true;
}

/** Коректно закриває браузер runner (CDP), щоб профіль із входами записався; лише якщо не вийшло — завершує процес. */
export async function closeBrowser() {
  if (!await cdpReady()) return true;
  try {
    const version = await (await fetch(`${cdpBase()}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
    await new Promise((resolve) => {
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      const done = () => { try { ws.close(); } catch { /* закрито */ } resolve(); };
      ws.addEventListener('open', () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(done, 1500); });
      ws.addEventListener('error', done);
      ws.addEventListener('close', done);
    });
  } catch { /* перевіримо порт нижче */ }
  const closed = await waitFor(async () => !(await cdpReady()), 15);
  if (closed) return true;
  try {
    const recorded = JSON.parse(readFileSync(browserFile(), 'utf8'));
    if (pidAlive(Number(recorded.pid))) spawnSync('taskkill', ['/PID', String(recorded.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch { /* запису немає */ }
  return waitFor(async () => !(await cdpReady()), 5);
}

async function main() {
  if (process.platform !== 'win32') { console.error('Цей запуск призначений для Windows; на Linux використовуйте scripts/whatsapp-runner.sh.'); return 2; }
  loadRunnerEnv();
  if (process.argv.includes('--close-browser')) return (await closeBrowser()) ? 0 : 1;
  if (!acquireLock()) { log('Runner уже запущений — другий не потрібен.'); return 0; }
  process.env.WORK_OS_URL = (process.env.WORK_OS_URL || DEFAULT_URL).replace(/\/$/, '');
  if (!await ensureBrowser()) return 1;
  process.env.WORK_OS_WHATSAPP_CDP = cdpBase();
  // Токен прив'язки з runner.env; без нього runner читає його зі сторінки Work OS у браузері runner.
  if (!process.env.WORK_OS_EXECUTOR_TOKEN && !process.argv.includes('--token-from-work-os-page')) process.argv.push('--token-from-work-os-page');
  process.chdir(stateDir());
  await import(pathToFileURL(RUNNER_ENTRY).href);
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await main();
  if (code !== null) process.exit(code);
}
