#!/usr/bin/env node
// Перенесення входів runner між системами: збереження зашифрованого архіву в хмару Work OS і відновлення з нього.
// Усе (пакування, шифрування, розпакування) відбувається на ПК; у хмару йде лише зашифрований файл, пароль нікуди не передається.
//
// Як це використовується:
//   - runner (chat-discovery-runner.mjs) імпортує planBackup/executeBackup: команда «Зберегти для перенесення» з картки в Work OS;
//   - інсталятор на новій системі викликає `node scripts/runner-transfer.mjs restore --site URL --token ТОКЕН`.
// Архів містить: профіль браузера runner (сесії WhatsApp і Telegram: IndexedDB, Local Storage), дані Waydroid (Android з Viber),
// ключ adb й пам'ять Telegram. Кеші не пакуються. Налаштування ПК (runner.env: токен, шлях браузера) в архів не йдуть.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { encryptToFile, decryptFile, sha256File, verifyFile, VaultError } from './runner-vault.mjs';

const MANIFEST_NAME = '.work-os-transfer.json';
const OWN_PROFILE_REL = '.local/share/work-os-runner-browser';
const DEFAULT_PORT = 9222;
const ATTEMPTS = 5;

/** Кеші, яких не пакуємо: вони великі й відновлюються самі. IndexedDB і Local Storage (сесії месенджерів) сюди не потрапляють. */
export const CACHE_EXCLUDES = [
  'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'CacheStorage', 'ScriptCache', 'Crashpad', 'Crash Reports', 'BrowserMetrics', 'BrowserMetrics-spare.pma', 'component_crx_cache',
  'extensions_crx_cache', 'optimization_guide_model_store', 'OptGuideOnDeviceModel', 'Media Cache', 'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  // Android: кеші застосунків і системи (дані Viber лишаються).
  'dalvik-cache', 'cache', 'code_cache', 'cache_http',
];

const home = () => homedir();
const stateDir = () => join(process.env.XDG_STATE_HOME || join(home(), '.local', 'state'), 'work-os');
const confFile = () => join(process.env.XDG_CONFIG_HOME || join(home(), '.config'), 'work-os', 'runner.env');
const appsDir = () => join(process.env.XDG_DATA_HOME || join(home(), '.local', 'share'), 'applications');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}

function readRunnerEnv() {
  const values = {};
  try {
    for (const line of readFileSync(confFile(), 'utf8').split('\n')) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
    }
  } catch { /* файлу ще немає */ }
  return values;
}

/** Профіль браузера, у якому залогінені WhatsApp і Telegram, і чи це окремий профіль runner («own») чи щоденний браузер власника («daily»). */
export function detectBrowserProfile() {
  const env = { ...readRunnerEnv(), ...Object.fromEntries(['WORK_OS_BROWSER_PROFILE', 'WORK_OS_BROWSER'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
  const own = join(home(), OWN_PROFILE_REL);
  if (env.WORK_OS_BROWSER_PROFILE && existsSync(env.WORK_OS_BROWSER_PROFILE)) {
    return { path: env.WORK_OS_BROWSER_PROFILE, kind: 'own', launch: 'own' };
  }
  const desktop = desktopWithCdp();
  if (desktop) {
    const dir = /--user-data-dir=(\S+)/.exec(desktop.exec)?.[1];
    if (dir && existsSync(dir)) return { path: dir, kind: 'daily', launch: 'desktop', desktop };
    const guess = [['opera', '.config/opera'], ['google-chrome', '.config/google-chrome'], ['chromium', '.config/chromium'], ['brave', '.config/BraveSoftware/Brave-Browser']]
      .find(([name, rel]) => desktop.exec.includes(name) && existsSync(join(home(), rel)));
    if (guess) return { path: join(home(), guess[1]), kind: 'daily', launch: 'desktop', desktop, browser: guess[0] };
  }
  if (existsSync(own)) return { path: own, kind: 'own', launch: 'own' };
  return null;
}

function desktopWithCdp() {
  const port = process.env.WORK_OS_CDP_PORT || DEFAULT_PORT;
  let files = [];
  try { files = readdirSync(appsDir()); } catch { return null; }
  for (const file of files) {
    if (!file.endsWith('.desktop') || file === 'work-os-runner-browser.desktop') continue;
    try {
      const text = readFileSync(join(appsDir(), file), 'utf8');
      if (!text.includes(`--remote-debugging-port=${port}`)) continue;
      const exec = /^Exec=(.*)$/m.exec(text)?.[1] || '';
      const name = /^Name=(.*)$/m.exec(text)?.[1] || file;
      return { file, exec, name };
    } catch { /* пропускаємо нечитабельний запис */ }
  }
  return null;
}

const relFromHome = (path) => (path.startsWith(`${home()}/`) ? path.slice(home().length + 1) : null);

/** Що пакуємо (шляхи відносно домашньої теки) і яким буде маніфест. */
export function backupSources() {
  const profile = detectBrowserProfile();
  const sources = [];
  if (profile && relFromHome(profile.path)) sources.push(relFromHome(profile.path));
  const waydroid = '.local/share/waydroid';
  if (existsSync(join(home(), waydroid))) sources.push(waydroid);
  for (const rel of ['.android/adbkey', '.android/adbkey.pub']) if (existsSync(join(home(), rel))) sources.push(rel);
  for (const name of ['telegram-scanned-groups.json', 'telegram-revisit-plan.json']) {
    const rel = relFromHome(join(stateDir(), name));
    if (rel && existsSync(join(home(), rel))) sources.push(rel);
  }
  return { profile, sources, waydroid: sources.includes(waydroid) };
}

const excludeArgs = (flag = '--exclude=') => CACHE_EXCLUDES.map((name) => `${flag}${name}`);

/** Чи є в даних Waydroid файли, яких користувач не може прочитати (uid Android): тоді пакування потребує sudo. */
export function waydroidNeedsRoot() {
  const dir = join(home(), '.local/share/waydroid');
  if (!existsSync(dir)) return false;
  const result = spawnSync('find', [dir, '(', '!', '-readable', '-o', '!', '-user', String(process.getuid?.() ?? 0), ')', '-print', '-quit'], { encoding: 'utf8' });
  return result.status === 0 && Boolean(result.stdout.trim());
}

export function sudoNeedsPassword() {
  if (process.getuid?.() === 0) return false;
  return spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status !== 0;
}

/** Орієнтовний розмір пакування (без кешів): показується перед вивантаженням. Архів буде меншим: дані стискаються лише частково. */
export function estimateBackup() {
  const { sources, profile, waydroid } = backupSources();
  let bytes = 0;
  for (const rel of sources) {
    const result = spawnSync('du', ['-sb', ...excludeArgs(), '--', join(home(), rel)], { encoding: 'utf8', maxBuffer: 1 << 20 });
    bytes += Number((result.stdout || '').split('\t')[0]) || 0;
  }
  return { bytes, sources, profile, waydroid, needsRoot: waydroid && waydroidNeedsRoot() };
}

// --- Браузер і Waydroid ---------------------------------------------------------------------------------------------------------
async function cdpVersion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

/** Закриває браузер через CDP (`Browser.close`) і чекає, поки порт замовкне: інакше копія профілю буде битою. */
export async function closeBrowser(port = DEFAULT_PORT) {
  const info = await cdpVersion(port);
  if (!info) return false;
  await new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(info.webSocketDebuggerUrl); } catch { resolve(); return; }
    const done = () => { try { ws.close(); } catch { /* уже закрито */ } resolve(); };
    ws.addEventListener('open', () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(done, 1500); });
    ws.addEventListener('close', done);
    ws.addEventListener('error', done);
  });
  for (let i = 0; i < 60; i += 1) { if (!(await cdpVersion(port))) { await sleep(1500); return true; } await sleep(500); }
  throw new Error('Браузер не закрився за 30 с: закрий його сам і повтори.');
}

export function launchBrowser(profile, port = DEFAULT_PORT) {
  const env = { ...readRunnerEnv(), ...process.env };
  const url = (env.WORK_OS_URL || '').replace(/\/$/, '');
  if (profile?.launch === 'desktop' && profile.desktop?.exec) {
    const command = profile.desktop.exec.replace(/%[a-zA-Z]/g, '').trim();
    spawn('sh', ['-c', command], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const binary = env.WORK_OS_BROWSER || ['opera', 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave-browser'].find((name) => spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0);
  if (!binary) return;
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile?.path || join(home(), OWN_PROFILE_REL)}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--no-first-run', '--no-default-browser-check', ...(url ? [url] : []), 'https://web.whatsapp.com/'];
  spawn(binary, args, { detached: true, stdio: 'ignore' }).unref();
}

function waydroidRunning() {
  const result = spawnSync('waydroid', ['status'], { encoding: 'utf8', timeout: 15000 });
  return result.status === 0 && /Session:.*RUNNING/i.test(result.stdout || '');
}
async function stopWaydroid() {
  if (!waydroidRunning()) return false;
  spawnSync('waydroid', ['session', 'stop'], { stdio: 'ignore', timeout: 60000 });
  for (let i = 0; i < 60; i += 1) { if (!waydroidRunning()) return true; await sleep(1000); }
  throw new Error('Сесія Waydroid не зупинилась за 60 с.');
}
function startWaydroid() {
  spawn('sh', ['-c', 'nohup waydroid session start >/dev/null 2>&1 &'], { detached: true, stdio: 'ignore' }).unref();
}

// --- Права root для даних Android -----------------------------------------------------------------------------------------------
/** `sudo -A` із тимчасовим помічником, що віддає пароль із середовища одного процесу sudo; пароль не потрапляє в аргументи й на диск. */
function rootRunner(auth) {
  if (auth?.kind === 'none' || process.getuid?.() === 0) return { command: (argv) => ({ file: argv[0], args: argv.slice(1), env: process.env }), cleanup() {} };
  if (auth?.kind === 'askpass') {
    const dir = mkdtempSync(join(tmpdir(), 'wos-askpass-'));
    chmodSync(dir, 0o700);
    const script = join(dir, 'askpass.sh');
    writeFileSync(script, '#!/bin/sh\nprintf \'%s\\n\' "$WOS_SUDO_PW"\n', { mode: 0o700 });
    return { command: (argv) => ({ file: 'sudo', args: ['-A', '--', ...argv], env: { ...process.env, SUDO_ASKPASS: script, WOS_SUDO_PW: auth.password || '' } }), cleanup() { rmSync(dir, { recursive: true, force: true }); } };
  }
  return { command: (argv) => ({ file: 'sudo', args: ['--', ...argv], env: process.env }), cleanup() {} };
}

/** Перевіряє права root заздалегідь (до закриття браузера): неправильний пароль не повинен дати «порожній» архів без даних Android. */
export function checkRoot(auth) {
  if (auth?.kind === 'none' || process.getuid?.() === 0) return true;
  const root = rootRunner(auth);
  try {
    const spec = root.command(['true']);
    const result = spawnSync(spec.file, spec.args.length && spec.args[0] === '-A' ? ['-A', '-v'] : spec.args, { env: spec.env, stdio: auth?.kind === 'tty' ? 'inherit' : 'ignore' });
    return result.status === 0;
  } finally { root.cleanup(); }
}

// --- Мережа: частини з повтором --------------------------------------------------------------------------------------------------
function faultFor(kind, part, attempt) {
  const spec = process.env.WORK_OS_TRANSFER_FAULT || '';
  return attempt === 1 && spec.split(',').includes(`${kind}:${part}`);
}
async function withRetry(label, fn, signal) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('Скасовано.');
    try { return await fn(attempt); } catch (error) {
      lastError = error;
      if (error?.fatal) throw error;
      await sleep(Math.min(8000, 500 * 2 ** attempt) * (process.env.WORK_OS_TRANSFER_FAST ? 0.02 : 1));
    }
  }
  throw new Error(`${label}: не вдалося після ${ATTEMPTS} спроб (${lastError instanceof Error ? lastError.message : 'помилка мережі'}).`);
}
const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });
async function api(baseUrl, token, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...authHeaders(token), ...init.headers } });
  if (!response.ok) {
    const detail = await response.json().then((body) => body?.error, () => '').catch(() => '');
    const error = new Error(detail || `відповідь ${response.status}`);
    error.status = response.status;
    error.fatal = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
    throw error;
  }
  return response;
}

/** Вивантажує файл частинами (multipart R2 через воркер), кожну частину з повтором. */
export async function uploadArchive({ baseUrl, token, path, sha256, version, onProgress, signal }) {
  const size = statSync(path).size;
  const start = await (await withRetry('початок вивантаження', () => api(baseUrl, token, '/api/runner/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', sizeBytes: size }) }), signal)).json();
  const { id, uploadId, partSize } = start;
  const parts = [];
  const handle = await open(path, 'r');
  try {
    const count = Math.ceil(size / partSize);
    for (let part = 1; part <= count; part += 1) {
      const offset = (part - 1) * partSize;
      const length = Math.min(partSize, size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const uploaded = await withRetry(`частина ${part} з ${count}`, async (attempt) => {
        if (faultFor('up', part, attempt)) throw new Error('імітований обрив');
        const response = await api(baseUrl, token, `/api/runner/backup?id=${id}&uploadId=${encodeURIComponent(uploadId)}&part=${part}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer, signal });
        return response.json();
      }, signal);
      parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
      onProgress?.(part, count, offset + length, size);
    }
    const done = await (await withRetry('завершення вивантаження', () => api(baseUrl, token, '/api/runner/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', id, uploadId, parts, sizeBytes: size, sha256, version, host: hostname() }) }), signal)).json();
    return { id, backups: done.backups };
  } catch (error) {
    await api(baseUrl, token, '/api/runner/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'abort', id, uploadId }) }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
}

export async function downloadArchive({ baseUrl, token, backup, path, onProgress, signal }) {
  const handle = await open(path, 'w', 0o600);
  try {
    for (let part = 1; part <= backup.parts; part += 1) {
      const offset = (part - 1) * backup.partSize;
      const expected = Math.min(backup.partSize, backup.sizeBytes - offset);
      const buffer = await withRetry(`частина ${part} з ${backup.parts}`, async (attempt) => {
        if (faultFor('down', part, attempt)) throw new Error('імітований обрив');
        const response = await api(baseUrl, token, `/api/runner/backup?download=${backup.id}&part=${part}`, { signal });
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length !== expected) throw new Error('частина прийшла не повністю');
        return data;
      }, signal);
      await handle.write(buffer, 0, buffer.length, offset);
      onProgress?.(part, backup.parts, offset + expected, backup.sizeBytes);
    }
  } finally {
    await handle.close();
  }
}

// --- Збереження --------------------------------------------------------------------------------------------------------------------
function tarCommand(root, sources, manifestDir) {
  const argv = ['tar', '--numeric-owner', '--ignore-failed-read', '--warning=no-file-changed', ...excludeArgs(), '-C', manifestDir, '-cf', '-', MANIFEST_NAME, '-C', home(), ...sources];
  return root.command(argv);
}

/**
 * Закрити браузер і Waydroid → запакувати → зашифрувати → вивантажити → усе підняти назад.
 * `progress({ phase, text, percent, bytes, total })` іде в live-канал; `secrets.password` — пароль архіву, `secrets.sudo` — пароль користувача (лише для даних Android).
 */
export async function executeBackup({ baseUrl, token, secrets, progress = () => {}, signal, version = '', estimate }) {
  const plan = estimate || estimateBackup();
  const profile = plan.profile;
  const port = Number(process.env.WORK_OS_CDP_PORT) || DEFAULT_PORT;
  const auth = plan.needsRoot ? (process.env.WORK_OS_TRANSFER_NO_SUDO ? { kind: 'none' } : { kind: 'askpass', password: secrets.sudo || '' }) : { kind: 'none' };
  if (!checkRoot(auth)) throw new Error('Неправильний пароль користувача (sudo): дані Android без нього не прочитати.');
  const root = rootRunner(auth);
  const cacheDir = join(process.env.XDG_CACHE_HOME || join(home(), '.cache'), 'work-os');
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const archive = join(cacheDir, `runner-transfer-${Date.now()}.wosv`);
  const manifestDir = mkdtempSync(join(tmpdir(), 'wos-manifest-'));
  let browserWasClosed = false;
  let waydroidWasRunning = false;
  try {
    progress({ phase: 'closing', text: 'Закриваю браузер і Android', percent: 1 });
    browserWasClosed = await closeBrowser(port);
    waydroidWasRunning = await stopWaydroid();
    writeFileSync(join(manifestDir, MANIFEST_NAME), JSON.stringify({ v: 1, version, createdAt: Date.now(), host: hostname(), profile: profile ? { rel: relFromHome(profile.path), kind: profile.kind, browser: profile.browser || '' } : null, waydroid: plan.waydroid }));
    progress({ phase: 'packing', text: `Пакую і шифрую (орієнтовно ${formatBytes(plan.bytes)})`, percent: 3, bytes: 0, total: plan.bytes });
    const spec = tarCommand(root, plan.sources, manifestDir);
    const child = spawn(spec.file, spec.args, { env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
    const exited = new Promise((resolve) => child.on('close', resolve));
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    let packed = 0;
    let lastReport = 0;
    const encrypted = await encryptToFile(child.stdout, archive, secrets.password, {
      onBytes: (count) => {
        packed += count;
        if (Date.now() - lastReport > 1500) { lastReport = Date.now(); progress({ phase: 'packing', text: `Пакую і шифрую: ${formatBytes(packed)}`, percent: 3 + Math.min(1, packed / Math.max(plan.bytes, 1)) * 42, bytes: packed, total: plan.bytes }); }
      },
    });
    const code = await exited;
    if (signal?.aborted) throw new Error('Скасовано.');
    if (code !== 0 && code !== 1) throw new Error(`tar завершився з кодом ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`);
    progress({ phase: 'uploading', text: `Вивантажую ${formatBytes(encrypted.size)} у хмару`, percent: 46, bytes: 0, total: encrypted.size });
    const result = await uploadArchive({
      baseUrl, token, path: archive, sha256: encrypted.sha256, version, signal,
      onProgress: (part, count, bytes, total) => progress({ phase: 'uploading', text: `Вивантажую: частина ${part} з ${count}`, percent: 46 + (bytes / total) * 52, bytes, total }),
    });
    const saved = result.backups?.[0];
    progress({ phase: 'done', text: `Збережено · ${formatBytes(encrypted.size)}`, percent: 100, bytes: encrypted.size, total: encrypted.size, backup: saved });
    return saved;
  } finally {
    root.cleanup();
    rmSync(manifestDir, { recursive: true, force: true });
    rmSync(archive, { force: true });
    if (browserWasClosed) { try { launchBrowser(profile, port); } catch { /* runner лишиться без браузера: трей підніме його */ } }
    if (waydroidWasRunning) startWaydroid();
  }
}

// --- Відновлення -------------------------------------------------------------------------------------------------------------------
function decryptedTar(path, password, onBytes) {
  return Readable.from(decryptFile(path, password, { onBytes }));
}

function readManifestFrom(path, password) {
  return new Promise((resolve) => {
    const child = spawn('tar', ['-xOf', '-', '--occurrence=1', MANIFEST_NAME], { stdio: ['pipe', 'pipe', 'ignore'] });
    let text = '';
    child.stdout.on('data', (data) => { text += data; });
    const source = decryptedTar(path, password);
    child.stdin.on('error', () => undefined);
    source.pipe(child.stdin);
    child.on('close', () => { source.destroy(); try { resolve(JSON.parse(text)); } catch { resolve(null); } });
  });
}

function moveAside(path, stamp, log) {
  if (!existsSync(path)) return;
  const aside = `${path}.bak-${stamp}`;
  renameSync(path, aside);
  log?.(`Наявне відкладено: ${path} → ${aside}`);
}

/**
 * Завантажити частини → звірити SHA-256 → перевірити пароль і цілісність (повний прохід, нічого не розпаковуючи) → розпакувати в проміжну теку →
 * розкласти на місця. Наявне не затирається, а відкладається в `*.bak-ДАТА`.
 * `rootAuth`: { kind: 'tty' } (термінал інсталятора), { kind: 'askpass', password } або { kind: 'none' }.
 */
export async function executeRestore({ baseUrl, token, backup, password, rootAuth = { kind: 'tty' }, progress = () => {}, signal, log = () => {} }) {
  const cacheDir = join(process.env.XDG_CACHE_HOME || join(home(), '.cache'), 'work-os');
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const archive = join(cacheDir, `runner-restore-${Date.now()}.wosv`);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Date.now().toString(36).slice(-4);
  // Проміжна тека лежить у домашній теці: `rename` на місця (профіль, Waydroid) лишається в межах однієї файлової системи.
  const staging = join(home(), '.local', 'share', 'work-os', `restore-${Date.now()}`);
  let root = null;
  try {
    progress({ phase: 'downloading', text: `Завантажую архів (${formatBytes(backup.sizeBytes)})`, percent: 0 });
    await downloadArchive({ baseUrl, token, backup, path: archive, signal, onProgress: (part, count, bytes, total) => progress({ phase: 'downloading', text: `Завантажую: частина ${part} з ${count}`, percent: (bytes / total) * 40 }) });
    progress({ phase: 'verifying', text: 'Перевіряю контрольну суму', percent: 41 });
    if ((await sha256File(archive)) !== backup.sha256) throw new VaultError('Контрольна сума архіву не збігається: файл пошкоджено під час завантаження. Спробуй ще раз.', 'sha_mismatch');
    progress({ phase: 'verifying', text: 'Перевіряю пароль і цілісність', percent: 45 });
    let checked = 0;
    await verifyFile(archive, password, { onBytes: (count) => { checked += count; progress({ phase: 'verifying', text: `Перевіряю цілісність: ${formatBytes(checked)}`, percent: 45 + Math.min(1, checked / (backup.sizeBytes * 1.2)) * 20 }); } });
    const manifest = await readManifestFrom(archive, password);
    if (!manifest) throw new VaultError('В архіві немає опису вмісту: він створений не Work OS.', 'no_manifest');
    const auth = manifest.waydroid ? rootAuth : { kind: 'none' };
    if (!checkRoot(auth)) throw new Error('Не вдалося отримати права root (sudo): дані Android без них не розпакувати.');
    root = rootRunner(auth);
    mkdirSync(staging, { recursive: true });
    progress({ phase: 'extracting', text: 'Розпаковую', percent: 66 });
    const spec = root.command(['tar', '--numeric-owner', '-xpf', '-', '-C', staging]);
    const child = spawn(spec.file, spec.args, { env: spec.env, stdio: ['pipe', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
    const exited = new Promise((resolve) => child.on('close', resolve));
    child.stdin.on('error', () => undefined);
    let extracted = 0;
    const source = decryptedTar(archive, password, (count) => { extracted += count; progress({ phase: 'extracting', text: `Розпаковую: ${formatBytes(extracted)}`, percent: 66 + Math.min(1, extracted / Math.max(checked, 1)) * 28 }); });
    source.pipe(child.stdin);
    const code = await exited;
    if (code !== 0) throw new Error(`розпакування не вдалось (tar ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''})`);
    // Усе, крім даних Android, мусить належати поточному користувачеві (uid на старій системі міг бути іншим); дані Android лишають власників.
    if (manifest.waydroid) {
      const uid = String(process.getuid?.() ?? 0);
      const gid = String(process.getgid?.() ?? 0);
      const chown = root.command(['find', staging, '-path', join(staging, '.local/share/waydroid'), '-prune', '-o', '-exec', 'chown', '-h', `${uid}:${gid}`, '{}', '+']);
      spawnSync(chown.file, chown.args, { env: chown.env, stdio: 'ignore' });
    }
    progress({ phase: 'placing', text: 'Розкладаю на місця', percent: 95 });
    const placed = [];
    const place = (fromRel, to) => {
      const from = join(staging, fromRel);
      if (!existsSync(from)) return;
      mkdirSync(dirname(to), { recursive: true });
      moveAside(to, stamp, log);
      try { renameSync(from, to); } catch (error) {
        // Ціль на іншій файловій системі (свій шлях профілю): переносить `mv`, для даних Android з правами root.
        if (error?.code !== 'EXDEV') throw error;
        const mv = root.command(['mv', from, to]);
        if (spawnSync(mv.file, mv.args, { env: mv.env, stdio: 'ignore' }).status !== 0) throw error;
      }
      placed.push(to);
    };
    if (manifest.profile?.rel) {
      const target = readRunnerEnv().WORK_OS_BROWSER_PROFILE || join(home(), OWN_PROFILE_REL);
      place(manifest.profile.rel, target);
      if (manifest.profile.kind === 'daily') log(`Профіль щоденного браузера (${manifest.profile.browser || 'Chromium'}) розгорнуто як окремий профіль runner: ${target}`);
    }
    place('.local/share/waydroid', join(home(), '.local/share/waydroid'));
    for (const rel of ['.android/adbkey', '.android/adbkey.pub']) place(rel, join(home(), rel));
    for (const name of ['telegram-scanned-groups.json', 'telegram-revisit-plan.json']) place(relFromHome(join(stateDir(), name)) || '', join(stateDir(), name));
    progress({ phase: 'done', text: 'Входи відновлено', percent: 100 });
    return { placed, manifest };
  } finally {
    root?.cleanup();
    rmSync(archive, { force: true });
    const cleaner = rootRunner(rootAuth);
    const rm = cleaner.command(['rm', '-rf', staging]);
    spawnSync(rm.file, rm.args, { env: rm.env, stdio: 'ignore' });
    cleaner.cleanup();
  }
}

// --- Термінал інсталятора ------------------------------------------------------------------------------------------------------------
async function readTtyLine(question, { hidden = false } = {}) {
  const { openSync, createReadStream } = await import('node:fs');
  const { default: tty } = await import('node:tty');
  let fd;
  try { fd = openSync('/dev/tty', 'r+'); } catch { throw new Error('Немає термінала для введення (запустіть інсталятор у терміналі).'); }
  const input = new tty.ReadStream(fd);
  const output = new tty.WriteStream(openSync('/dev/tty', 'w'));
  output.write(question);
  return new Promise((resolve) => {
    let value = '';
    if (hidden) input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { if (hidden) input.setRawMode(false); input.removeListener('data', onData); input.pause(); input.destroy(); output.write('\n'); resolve(value); return; }
        if (char === '\u0003') { if (hidden) input.setRawMode(false); output.write('\n'); process.exit(130); }
        if (char === '\u007f') value = value.slice(0, -1); else value += char;
      }
    });
  });
}

async function cli() {
  const [, , command, ...rest] = process.argv;
  const arg = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : ''; };
  if (command !== 'restore') { console.error('Використання: runner-transfer.mjs restore --site URL --token ТОКЕН [--yes]'); process.exit(2); }
  const baseUrl = arg('--site').replace(/\/$/, '');
  const token = arg('--token');
  if (!baseUrl || !token) { console.error('Потрібні --site і --token.'); process.exit(2); }
  const list = await (await api(baseUrl, token, '/api/runner/backup')).json();
  const backup = (list.backups || [])[0];
  if (!backup) { console.log('Архіву входів у хмарі немає: це перший ПК, входи в месенджери доведеться зробити вручну.'); process.exit(3); }
  const when = new Date(backup.createdAt * 1000);
  const label = `${String(when.getDate()).padStart(2, '0')}.${String(when.getMonth() + 1).padStart(2, '0')} о ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  if (!rest.includes('--yes')) {
    const answer = (await readTtyLine(`Відновити входи з архіву від ${label} (${formatBytes(backup.sizeBytes)})? [Y/n] `)).trim().toLowerCase();
    if (answer && !['y', 'yes', 'т', 'так'].includes(answer)) { console.log('Відновлення пропущено.'); process.exit(4); }
  }
  console.log('Дані Android у Waydroid мають власників Android, тож розпакування їх потребує root: sudo попросить пароль у цьому терміналі.');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const password = process.env.WORK_OS_TRANSFER_PASSWORD || await readTtyLine('Пароль архіву: ', { hidden: true });
    let last = '';
    try {
      const result = await executeRestore({ baseUrl, token, backup, password, rootAuth: process.env.WORK_OS_TRANSFER_NO_SUDO ? { kind: 'none' } : { kind: 'tty' }, log: (line) => console.log(line), progress: (event) => { const text = `${Math.round(event.percent)} % · ${event.text}`; if (text !== last) { last = text; process.stdout.write(`\r\x1b[K  ${text}`); } } });
      process.stdout.write('\n');
      console.log(`Відновлено: ${result.placed.length} елементів.`);
      process.exit(0);
    } catch (error) {
      process.stdout.write('\n');
      console.error(`Помилка: ${error instanceof Error ? error.message : String(error)}`);
      if (!(error instanceof VaultError) || error.code !== 'bad_password' || process.env.WORK_OS_TRANSFER_PASSWORD) process.exit(1);
      console.error(`Спроба ${attempt} з 3.`);
    }
  }
  process.exit(1);
}

if (process.argv[1] && basename(process.argv[1]) === 'runner-transfer.mjs') await cli();
