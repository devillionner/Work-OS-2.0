// Публічна демо-версія (воркер `work-os-demo`). Цей файл потрапляє в збірку лише коли CLOUDFLARE_ENV=demo
// (scripts/normalize-wrangler-config.mjs): у staging і production його немає, тож жодна гілка звідси там недосяжна.
//
// Що робить:
//  - відмовляється працювати, якщо база не демонстраційна (у `users` будь-хто, окрім demo@example.test);
//  - підставляє вхід демо-власника, тож Google-вхід і хмарні секрети не потрібні;
//  - не виконує зовнішніх дій (автопост, runner, резервні копії, вихід): відповідь 403 із заголовком x-demo-blocked;
//  - тримає ліміти запитів на IP за хвилину та добові стелі читань і записів (DemoGuard), щоб публічний трафік
//    не з'їв спільні ліміти акаунта Cloudflare (D1 і Workers рахуються на весь акаунт, разом зі staging);
//  - щоночі за cron стирає й заново засіває базу (demoReset).
import { DEMO_BLOCK_HEADER, DEMO_BLOCK_MESSAGES, DEMO_EMAIL, DEMO_SESSION_TOKEN, isDemoBlocked, kyivMidnight } from '../lib/demo.ts';
import seed from 'demo-seed-data';

/** Запитів за хвилину з одного IP. */
const READS_PER_MINUTE = 150;
const WRITES_PER_MINUTE = 30;
/** Добові стелі на весь демо-воркер (доба за UTC, як і добові ліміти D1). Після стелі записи (або все) вимкнені до нічного скидання. */
const DAILY_READS = 6000;
const DAILY_WRITES = 600;

let verifiedDemoDb = false;
let outboundGuardInstalled = false;

function blocked(request, kind) {
  const status = kind === 'unavailable' ? 403 : kind === 'rate' ? 429 : 503;
  const headers = { [DEMO_BLOCK_HEADER]: kind, 'Cache-Control': 'no-store' };
  const wantsJson = new URL(request.url).pathname.startsWith('/api/') || request.headers.get('accept')?.includes('application/json');
  if (wantsJson) return Response.json({ error: `${DEMO_BLOCK_MESSAGES[kind]}.`, demo: true }, { status, headers });
  return new Response(`${DEMO_BLOCK_MESSAGES[kind]}.`, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * Демо-база: у `users` лише demo@example.test. Порожня (ще не засіяна) — окремий стан, чужі користувачі — відмова.
 * @param {Cloudflare.Env} env
 * @returns {Promise<'ok'|'empty'|'foreign'>}
 */
async function checkDemoDatabase(env) {
  if (verifiedDemoDb) return 'ok';
  const rows = await env.DB.prepare('SELECT email FROM users LIMIT 3').all();
  const emails = rows.results.map((row) => row.email);
  if (emails.some((email) => email !== DEMO_EMAIL)) return 'foreign';
  if (!emails.length) return 'empty';
  verifiedDemoDb = true;
  return 'ok';
}

/** Жоден код у демо не робить зовнішніх викликів (визначення назв чатів тощо): запит на чужий хост отримує 403. */
function installOutboundGuard(ownHost) {
  if (outboundGuardInstalled) return;
  outboundGuardInstalled = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    try {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(target, `https://${ownHost}`);
      if (url.host !== ownHost) return Promise.resolve(new Response('', { status: 403, headers: { [DEMO_BLOCK_HEADER]: 'unavailable' } }));
    } catch { /* незрозумілий URL віддаємо як є */ }
    return realFetch(input, init);
  };
}

/**
 * @param {Request} request
 * @param {Cloudflare.Env} env
 * @param {(request: Request) => Response | Promise<Response>} next застосунок (vinext) або шлюз /api/live
 */
export async function demoFetch(request, env, next) {
  if (env.DEMO_MODE !== '1' || !env.DEMO_GUARD) return new Response('Демо-режим не налаштовано.', { status: 503 });
  const url = new URL(request.url);
  const state = await checkDemoDatabase(env);
  if (state === 'foreign') return new Response('Це демо-воркер, але підключена база не демонстраційна. Роботу зупинено.', { status: 503 });
  if (state === 'empty') return new Response('Демо-дані ще готуються. Спробуйте за кілька хвилин.', { status: 503, headers: { 'Retry-After': '120' } });
  installOutboundGuard(url.host);

  const method = request.method.toUpperCase();
  if (isDemoBlocked(method, url.pathname)) return blocked(request, 'unavailable');

  if (url.pathname !== '/api/live') {
    const kind = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
    const stub = env.DEMO_GUARD.get(env.DEMO_GUARD.idFromName('limits'));
    const verdict = await (await stub.fetch(`https://demo-guard/take?kind=${kind}&k=${encodeURIComponent(ip)}`)).text();
    if (verdict !== 'ok') return blocked(request, verdict);
  }

  const headers = new Headers(request.headers);
  headers.set('cookie', `work_os_session=${DEMO_SESSION_TOKEN}`);
  return next(new Request(request, { headers }));
}

/**
 * Стирає всі таблиці й засіває демо-дані одним атомарним batch (збій лишає попередній стан).
 * Працює лише з демонстраційною (або порожньою) базою.
 * @param {Cloudflare.Env} env
 */
export async function demoReset(env) {
  if (env.DEMO_MODE !== '1') return { ok: false, reason: 'not_demo' };
  if ((await checkDemoDatabase(env)) === 'foreign') return { ok: false, reason: 'foreign_db' };
  const tables = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'`).all())
    .results.map((row) => row.name);
  const wipe = [...seed.wipeFirst.filter((name) => tables.includes(name)), ...tables.filter((name) => !seed.wipeFirst.includes(name))];
  const midnight = String(kyivMidnight(Date.now()));
  const statements = [
    env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
    ...wipe.map((name) => env.DB.prepare(`DELETE FROM ${name}`)),
    ...seed.statements.map((text) => env.DB.prepare(text.replaceAll('@T', midnight))),
  ];
  const results = await env.DB.batch(statements);
  verifiedDemoDb = true;
  const sum = (field) => results.reduce((total, result) => total + Number(result.meta?.[field] ?? 0), 0);
  const summary = { ok: true, tables: wipe.length, statements: statements.length, rowsRead: sum('rows_read'), rowsWritten: sum('rows_written') };
  console.log(`[demo] нічне скидання: ${JSON.stringify(summary)}`);
  return summary;
}

/** Cron Trigger воркера: нічне скидання. */
export function demoScheduled(env) {
  return demoReset(env);
}

/**
 * Лічильники для обмежень: за хвилину на IP (у пам'яті, кілька секунд дрейфу не шкодять) та добові стелі
 * (раз на кілька викликів скидаються у сховище, щоб пережити перезапуск об'єкта).
 */
export class DemoGuard {
  /** @param {DurableObjectState} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.windows = new Map();
    this.day = null;
    this.pending = 0;
    this.loaded = this.ctx.blockConcurrencyWhile(async () => { this.day = (await this.ctx.storage.get('day')) ?? { date: '', reads: 0, writes: 0 }; });
  }

  async fetch(request) {
    await this.loaded;
    const url = new URL(request.url);
    const write = url.searchParams.get('kind') === 'write';
    const key = url.searchParams.get('k') || 'x';
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.day.date !== today) this.day = { date: today, reads: 0, writes: 0 };

    let window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) { window = { start: now, reads: 0, writes: 0 }; this.windows.set(key, window); }
    if (this.windows.size > 4000) for (const [name, item] of this.windows) if (now - item.start >= 60_000) this.windows.delete(name);

    let verdict = 'ok';
    if (this.day.reads + this.day.writes >= DAILY_READS + DAILY_WRITES || this.day.reads >= DAILY_READS) verdict = 'reads';
    else if (write && this.day.writes >= DAILY_WRITES) verdict = 'writes';
    else if (write ? window.writes >= WRITES_PER_MINUTE : window.reads >= READS_PER_MINUTE) verdict = 'rate';

    if (verdict === 'ok') {
      if (write) { window.writes += 1; this.day.writes += 1; } else { window.reads += 1; this.day.reads += 1; }
      this.pending += 1;
      if (this.pending >= 25) { this.pending = 0; await this.ctx.storage.put('day', this.day); }
    }
    return new Response(verdict);
  }
}
