import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { readTimers } from '../lib/timers.ts';
import { createRefreshGate } from '../lib/refresh-gate.ts';

void test('timer reads project deadlines without writes and isolate owners', async t => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare(`CREATE TABLE work_timers (id TEXT PRIMARY KEY, user_id TEXT, label TEXT, platform TEXT, telegram_account_id TEXT, duration_seconds INTEGER, started_at INTEGER, ends_at INTEGER, status TEXT, completed_at INTEGER, created_at INTEGER)`).run();
  for (const [id, owner, ends, status] of [['due','u',100,'running'],['future','u',200,'running'],['dismissed','u',50,'dismissed'],['other','other',100,'running']]) {
    await db.prepare(`INSERT INTO work_timers VALUES (?1,?2,'Test','general',NULL,60,40,?3,?4,NULL,40)`).bind(id,owner,ends,status).run();
  }
  await db.prepare(`CREATE TRIGGER forbid_timer_update BEFORE UPDATE ON work_timers BEGIN SELECT RAISE(ABORT, 'Reads must not update timers'); END`).run();
  assert.equal((await readTimers(db, 'u', 99))[0].status, 'running');
  const timers = await readTimers(db, 'u', 100);
  assert.deepEqual(timers.map(timer => [timer.id, timer.status, timer.completedAt]), [['due','completed',100],['future','running',null]]);
  assert.deepEqual(await readTimers(db, 'u', 100), timers);
  assert.equal((await db.prepare("SELECT status FROM work_timers WHERE id='due'").first()).status, 'running');
  assert.deepEqual((await readTimers(db, 'other', 201)).map(timer => timer.id), ['other']);
});

void test('one-second clock, hidden/offline state and errors cannot flood refresh', async () => {
  const refresh = createRefreshGate(120_000);
  let calls = 0;
  const action = async () => { calls++; };
  await refresh(0, false, action);
  assert.equal(calls, 0);
  for (let now = 0; now < 120_000; now += 1000) await refresh(now, true, action);
  assert.equal(calls, 1);
  await assert.rejects(refresh(120_000, true, async () => { calls++; throw new Error('offline'); }), /offline/);
  for (let now = 121_000; now < 240_000; now += 1000) await refresh(now, true, action);
  assert.equal(calls, 2);
  await refresh(240_000, false, action);
  await refresh(241_000, true, action);
  assert.equal(calls, 3);
});

void test('slow refresh cannot overlap a later polling interval', async () => {
  const refresh = createRefreshGate(120_000);
  let finish;
  let calls = 0;
  const pending = refresh(0, true, () => new Promise(resolve => { calls++; finish = resolve; }));
  await refresh(240_000, true, async () => { calls++; });
  assert.equal(calls, 1);
  finish();
  await pending;
  await refresh(241_000, true, async () => { calls++; });
  assert.equal(calls, 2);
});

void test('remote migration attempts fail before config access or Wrangler startup', () => {
  const runner = new URL('../scripts/apply-d1-migrations.mjs', import.meta.url);
  const localEnv = {...process.env};
  delete localEnv.CI;
  for (const [flags, env] of [
    [[], localEnv],
    [['--allow-production'], localEnv],
    [['--allow-remote', '--reason', '--allow-production'], localEnv],
    [['--allow-remote', '--reason', 'release', '--allow-production'], {...localEnv, CI:'true'}],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(runner), '--database', 'DB', '--remote', '--config', 'does-not-exist.jsonc', ...flags], {env,encoding:'utf8'});
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /Remote D1 is not a test environment/);
  }
});
