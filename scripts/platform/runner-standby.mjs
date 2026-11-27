// «Черговий» runner (3.23.0): крихітний процес, який завжди на зв'язку з Work OS і запускає runner за командою з будь-якого пристрою
// (кнопка «Запустити runner» на телефоні). Посилання workos-runner://start працює лише на самому ПК, тож без чергового телефон
// до ПК не достукається.
//   node scripts/platform/runner-standby.mjs
// Що робить: один екземпляр (state/standby.lock), WebSocket /api/live?kind=standby тим самим токеном, що й runner (runner.env),
// пінг раз на 30 с (на нього відповідає автовідповідь Durable Object, без D1 і без пробудження), перепідключення з паузою до 5 хв.
// На {type:'start_runner'} запускає трей (Windows: work-os-runner-tray.ps1 -Wake; він уже сам піднімає runner, а коли трей уже працює,
// лише будить його) чи обробник workos-runner://start на Linux. Більше нічого не читає, не шле й не виконує.
// Переживає «Вимкнути повністю» в треї (вимикаються runner і трей, а не черговий). Сам виходить, коли його файл оновився: трей
// запускає нову копію.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_WINDOWS, stateDir } from './paths.mjs';
import { loadRunnerEnv } from './windows-launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = join(HERE, '..', '..');
const DEFAULT_URL = 'https://work-os-2-staging.devillionner.workers.dev';
const PING = JSON.stringify({ type: 'ping' });
const PONG = JSON.stringify({ type: 'pong' });
const PING_MS = 30_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 300_000;
const START_GAP_MS = 20_000;

const lockFile = () => join(stateDir(), 'standby.lock');
const logFile = () => join(stateDir(), 'standby.log');

function log(line) {
  try { appendFileSync(logFile(), `[${new Date().toLocaleString('uk-UA')}] ${line}\n`); } catch { /* немає куди писати */ }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/** Один черговий на користувача: трей запускає його при кожному старті, а другий одразу виходить. */
function acquireLock() {
  mkdirSync(stateDir(), { recursive: true });
  try {
    const held = JSON.parse(readFileSync(lockFile(), 'utf8'));
    const afterBoot = Number(held.startedAt) > Date.now() - uptime() * 1000;
    if (afterBoot && pidAlive(Number(held.pid)) && Number(held.pid) !== process.pid) return false;
  } catch { /* немає замка */ }
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  process.on('exit', () => {
    try { if (JSON.parse(readFileSync(lockFile(), 'utf8')).pid === process.pid) unlinkSync(lockFile()); } catch { /* уже немає */ }
  });
  return true;
}

let lastStartAt = 0;
/** Запуск runner тим самим шляхом, що й посилання workos-runner://start на ПК. */
function startRunner() {
  if (Date.now() - lastStartAt < START_GAP_MS) return;
  lastStartAt = Date.now();
  try {
    if (IS_WINDOWS) {
      // Без conhost: `conhost --headless` із процесу без консолі й зі stdio 'ignore' виходить одразу, нічого не запустивши (3.23.0,
      // перевірено 27.11). PowerShell напряму з CREATE_NO_WINDOW (windowsHide) працює й вікна не показує; трей — WinForms.
      const tray = join(ROOT, 'scripts', 'windows', 'work-os-runner-tray.ps1');
      const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tray, '-Wake'], { stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn('bash', [join(ROOT, 'scripts', 'work-os-runner-launch.sh')], { detached: true, stdio: 'ignore' }).unref();
    }
    log('Отримано «Запустити runner»: запускаю.');
  } catch (error) {
    log(`Не вдалося запустити runner: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function channelUrl(base, token) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/live';
  url.search = '';
  url.searchParams.set('kind', 'standby');
  url.searchParams.set('token', token);
  return url.toString();
}

function connect(base, token, state) {
  let ws;
  try { ws = new WebSocket(channelUrl(base, token)); } catch { schedule(base, token, state); return; }
  let settled = false;
  let keepalive = null;
  let awaitingPong = false;
  const down = () => {
    if (settled) return;
    settled = true;
    if (keepalive) clearInterval(keepalive);
    try { ws.close(); } catch { /* уже закритий */ }
    schedule(base, token, state);
  };
  ws.addEventListener('open', () => {
    state.delay = RECONNECT_MIN_MS;
    keepalive = setInterval(() => {
      // Без відповіді на попередній пінг — напіввідкритий сокет (сон, зміна мережі): перепідключаємось.
      if (awaitingPong) { down(); return; }
      awaitingPong = true;
      try { ws.send(PING); } catch { down(); }
    }, PING_MS);
  });
  ws.addEventListener('message', (event) => {
    if (event.data === PONG) { awaitingPong = false; return; }
    try { if (JSON.parse(String(event.data))?.type === 'start_runner') startRunner(); } catch { /* не наше */ }
  });
  ws.addEventListener('close', down);
  ws.addEventListener('error', down);
}

function schedule(base, token, state) {
  const delay = state.delay;
  state.delay = Math.min(RECONNECT_MAX_MS, state.delay * 2);
  setTimeout(() => connect(base, token, state), delay);
}

function main() {
  loadRunnerEnv();
  const token = process.env.WORK_OS_EXECUTOR_TOKEN || '';
  if (!token) { log('Немає токена прив\'язки в runner.env: черговий не потрібен.'); return; }
  if (!acquireLock()) return;
  const base = (process.env.WORK_OS_URL || DEFAULT_URL).replace(/\/$/, '');
  // Оновлений файл чергового: виходимо, трей запустить нову копію.
  let selfSig = '';
  try { const item = statSync(SELF); selfSig = `${item.mtimeMs}|${item.size}`; } catch { /* немає */ }
  setInterval(() => {
    try { const item = statSync(SELF); if (selfSig && `${item.mtimeMs}|${item.size}` !== selfSig) process.exit(0); } catch { /* файл замінюється */ }
  }, 60_000);
  log('Черговий запущений.');
  connect(base, token, { delay: RECONNECT_MIN_MS });
}

main();
