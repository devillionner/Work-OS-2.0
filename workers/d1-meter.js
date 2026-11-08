// Лічильник прочитаних рядків D1 (3.8.0) і запобіжник ліміту. Підключається в обгортці воркера (worker-entry.js)
// і працює в кожному ізоляті, зокрема й у Durable Object: перехоплює методи D1 (`run`, `all`, `first`, `raw`, `batch`),
// читає з відповіді `meta.rows_read` і складає за маршрутом запиту (AsyncLocalStorage). Підсумок рахує Durable Object
// `d1-meter` (OwnerChannel за ім'ям D1_METER_NAME; у D1 лічильник нічого не пише): ізолят надсилає накопичене раз на
// 5 хв або від 20 000 рядків (і лише коли накопичено від 500 рядків; у режимі економії раз на 15 хв), а у відповідь отримує денну суму й рівень.
// Кожен внесок — запит до Durable Object і йде до ліміту безкоштовного плану (100 тис. на добу), тому надсилаємо рідко: лічильник —
// страховка й диспетчер, а не точний облік. Помилка Durable Object (зокрема перевищення ліміту) ніколи не ламає основний запит.
//
// Рівні: від 1 млн рядків за добу власнику йде одне сповіщення, від 1,5 млн важкі необов'язкові читання (аналітика,
// дублікати, план автопосту, обслуговування лідів) відповідають 503 з поясненням; чати, автопост і ліди працюють далі.
// Якщо перехопити методи D1 не вдалося, лічильник просто вимкнений, застосунок працює як раніше.
import { AsyncLocalStorage } from 'node:async_hooks';
import { D1_BUDGET_TEXT, D1_METER_NAME, isHeavyRoute, meterSuspended } from '../lib/d1-meter-state.ts';

const FLUSH_ROWS = 20_000;
const FLUSH_MS = 5 * 60_000;
const FLUSH_MIN_ROWS = 500;
const ECONOMY_FLUSH_MS = 15 * 60_000;
const LEVEL_MS = 5 * 60_000;
const ECONOMY_LEVEL_MS = 15 * 60_000;
const DURABLE_OBJECT_ROUTE = 'durable-object';

/** @type {AsyncLocalStorage<string>} */
const routeStore = new AsyncLocalStorage();
/** @type {any} */
let meterEnv = null;
let installed = false;
let pending = { total: 0, routes: /** @type {Record<string, number>} */ ({}) };
// Відлік від першого запиту ізоляту (у глобальному контексті Date.now() ненадійний): короткоживучий ізолят нічого не шле, довгоживучий — раз на FLUSH_MS.
let lastFlushAt = 0;
let lastLevelAt = 0;
let level = 'ok';
let economy = false;
let levelDay = '';
/** @type {Promise<void>|null} */
let flushing = null;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Перехоплює методи D1 у цьому ізоляті. Безпечно викликати кілька разів.
 * @param {any} env
 */
export function installD1Meter(env) {
  meterEnv = env;
  if (!lastFlushAt) lastFlushAt = Date.now();
  if (installed || !env?.DB || !env?.OWNER_CHANNEL) return;
  try {
    const statement = Object.getPrototypeOf(env.DB.prepare('SELECT 1'));
    const database = Object.getPrototypeOf(env.DB);
    const define = (target, name, value) => Object.defineProperty(target, name, { configurable: true, writable: true, value });
    const run = statement.run;
    const all = statement.all;
    const raw = statement.raw;
    const batch = database.batch;
    if (![run, all, raw, batch].every((fn) => typeof fn === 'function')) return;
    define(statement, 'run', async function patchedRun(...args) {
      const result = await run.apply(this, args);
      await note(result?.meta?.rows_read);
      return result;
    });
    define(statement, 'all', async function patchedAll(...args) {
      const result = await all.apply(this, args);
      await note(result?.meta?.rows_read);
      return result;
    });
    // first() у D1 не віддає meta, тож виконуємо його через all(): запит той самий (first додає LIMIT не більше, ніж all).
    define(statement, 'first', async function patchedFirst(column) {
      const result = await this.all();
      const row = result?.results?.[0] ?? null;
      if (column === undefined || row === null) return row;
      if (!(column in row)) throw new Error(`D1_ERROR: No such column: ${column}`);
      return row[column];
    });
    // raw() теж без meta (його використовує Drizzle для вибірок лідів): рахуємо повернуті рядки, це нижня межа.
    define(statement, 'raw', async function patchedRaw(...args) {
      const rows = await raw.apply(this, args);
      const header = args[0]?.columnNames ? 1 : 0;
      await note(Array.isArray(rows) ? Math.max(0, rows.length - header) : 0);
      return rows;
    });
    define(database, 'batch', async function patchedBatch(...args) {
      const results = await batch.apply(this, args);
      let rows = 0;
      if (Array.isArray(results)) for (const item of results) rows += Number(item?.meta?.rows_read) || 0;
      await note(rows);
      return results;
    });
    installed = true;
  } catch {
    installed = false;
  }
}

/** @param {unknown} rowsRead */
async function note(rowsRead) {
  const rows = Math.max(0, Math.floor(Number(rowsRead) || 0));
  if (!rows || meterSuspended()) return;
  const route = routeStore.getStore() ?? DURABLE_OBJECT_ROUTE;
  if (!lastFlushAt) lastFlushAt = Date.now();
  pending.total += rows;
  pending.routes[route] = (pending.routes[route] ?? 0) + rows;
  // Не чекаємо Durable Object: запит до бази не повинен залежати від лічильника.
  if (pending.total >= FLUSH_ROWS || (pending.total >= FLUSH_MIN_ROWS && Date.now() - lastFlushAt >= (economy ? ECONOMY_FLUSH_MS : FLUSH_MS))) void flush();
}

/** @param {boolean} [force] надіслати й порожній внесок, щоб дізнатися поточний рівень */
async function flush(force = false) {
  if (flushing) return flushing;
  if (!meterEnv?.OWNER_CHANNEL || (!force && pending.total === 0)) return;
  const body = pending;
  pending = { total: 0, routes: {} };
  lastFlushAt = Date.now();
  flushing = (async () => {
    try {
      const stub = meterEnv.OWNER_CHANNEL.get(meterEnv.OWNER_CHANNEL.idFromName(D1_METER_NAME));
      const response = await stub.fetch('https://d1-meter/meter/add', { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`meter ${response.status}`);
      const status = await response.json();
      level = status.level === 'stop' || status.level === 'warn' ? status.level : 'ok';
      economy = status.economy === true;
      levelDay = String(status.day || today());
      lastLevelAt = Date.now();
    } catch {
      // Не вдалося надіслати: повертаємо внесок, щоб не втратити, але не накопичуємо без меж.
      pending.total += body.total;
      for (const [route, rows] of Object.entries(body.routes)) pending.routes[route] = (pending.routes[route] ?? 0) + rows;
      if (Object.keys(pending.routes).length > 200) pending = { total: pending.total, routes: { інше: pending.total } };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function currentLevel() {
  if (levelDay && levelDay !== today()) { level = 'ok'; levelDay = ''; }
  if (Date.now() - lastLevelAt >= (economy ? ECONOMY_LEVEL_MS : LEVEL_MS)) await flush(true);
  return levelDay === today() ? level : 'ok';
}

/**
 * Обгортка запиту воркера: запобіжник для важких читань, облік за маршрутом, відправка внеску після відповіді.
 * @param {Request} request
 * @param {any} env
 * @param {{waitUntil: (promise: Promise<unknown>) => void}} ctx
 * @param {() => Promise<Response>|Response} run
 */
export async function meteredFetch(request, env, ctx, run) {
  if (!installed) installD1Meter(env);
  if (!installed) return run();
  const url = new URL(request.url);
  try {
    if (isHeavyRoute(request.method, url.pathname, url.searchParams) && (await currentLevel()) === 'stop') {
      return Response.json({ error: D1_BUDGET_TEXT, code: 'd1_budget' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } });
    }
  } catch {
    // Збій запобіжника не повинен ламати запит.
  }
  try {
    return await routeStore.run(`${request.method} ${url.pathname}`, () => run());
  } finally {
    if (pending.total >= FLUSH_MIN_ROWS && Date.now() - lastFlushAt >= (economy ? ECONOMY_FLUSH_MS : FLUSH_MS)) ctx.waitUntil(flush().catch(() => {}));
  }
}
