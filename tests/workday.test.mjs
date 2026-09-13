import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkdayError,
  endWorkday,
  pauseWorkday,
  readWorkdaySnapshot,
  resumeWorkday,
  startWorkday,
} from '../lib/workday.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('workday counts only active time across pause and resume', async t => {
  const db = await localDatabase(t);
  const started = await startWorkday(db, { userId: 'u', today: '2026-09-13', now: 1000 });
  assert.equal(started.status, 'active');
  assert.equal(started.activeSeconds, 0);
  const paused = await pauseWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: 0, now: 1600 });
  assert.equal(paused.activeSeconds, 600);
  assert.equal((await readWorkdaySnapshot(db, 'u', '2026-09-13', 2600)).activeSeconds, 600);
  const resumed = await resumeWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: 1, now: 3000 });
  const ended = await endWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: 2, now: 3600 });
  assert.equal(resumed.status, 'active');
  assert.equal(ended.status, 'ended');
  assert.equal(ended.activeSeconds, 1200);
  assert.equal(ended.version, 3);
});

void test('open workday blocks another date until it is ended', async t => {
  const db = await localDatabase(t);
  const first = await startWorkday(db, { userId: 'u', today: '2026-09-12', now: 1000 });
  let blocked = false;
  try { await startWorkday(db, { userId: 'u', today: '2026-09-13', now: 2000 }); }
  catch (error) { blocked = error instanceof WorkdayError && error.status === 409; }
  assert.equal(blocked, true);

  let foreignBlocked = false;
  try { await pauseWorkday(db, { userId: 'other', id: first.id, workDate: first.workDate, expectedVersion: 0, now: 1200 }); }
  catch (error) { foreignBlocked = error instanceof WorkdayError && error.status === 409; }
  assert.equal(foreignBlocked, true);

  let staleBlocked = false;
  try { await pauseWorkday(db, { userId: 'u', id: first.id, workDate: first.workDate, expectedVersion: 9, now: 1200 }); }
  catch (error) { staleBlocked = error instanceof WorkdayError && error.status === 409; }
  assert.equal(staleBlocked, true);

  await endWorkday(db, { userId: 'u', id: first.id, workDate: first.workDate, expectedVersion: 0, now: 1800 });
  const today = await startWorkday(db, { userId: 'u', today: '2026-09-13', now: 2000 });
  assert.equal(today.workDate, '2026-09-13');
  assert.equal(await readWorkdaySnapshot(db, 'other', '2026-09-13', 2100), null);
});
