import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { activitySummaryStatement } from '../lib/activity-summary.ts';
import { endWorkday, readWorkdaySnapshot, refreshWorkdayPlanFocus, reopenWorkday, resetWorkday, startWorkday } from '../lib/workday.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

void test('REPORT-09 freezes the day plan when the workday starts and preserves it on reopen', async (t) => {
  const db = await localDatabase(t);
  const plan = { dailyGoal: 6, monthlyGoal: 120, focusDirections: ['Англійська', 'Математика'] };
  const started = await startWorkday(db, { userId: 'u', today: '2026-09-16', now: 1000, plan });
  assert.deepEqual(started.plan, { ...plan, createdAt: 1000 });

  const setting = await db.prepare(`SELECT value_json FROM user_settings
    WHERE user_id='u' AND setting_key=?1 LIMIT 1`).bind(`workday_plan:${started.id}`).first();
  assert.deepEqual(JSON.parse(setting.value_json), { ...plan, createdAt: 1000 });
  assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM activity_events WHERE user_id='u'`).first()).count, 0);
  assert.equal(await db.prepare(`SELECT revision FROM activity_day_revisions WHERE user_id='u' AND event_date='2026-09-16'`).first(), null);

  const later = await readWorkdaySnapshot(db, 'u', '2026-09-16', 1200);
  assert.deepEqual(later.plan, { ...plan, createdAt: 1000 });

  const ended = await endWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: 0, now: 1600 });
  const reopened = await reopenWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: ended.version, now: 1700 });
  assert.deepEqual(reopened.plan, { ...plan, createdAt: 1000 });
});

void test('day-plan snapshot is non-metric and reset removes only its owner-scoped snapshot', async (t) => {
  const db = await localDatabase(t);
  const started = await startWorkday(db, {
    userId: 'u', today: '2026-09-16', now: 1000,
    plan: { dailyGoal: 5, monthlyGoal: 100, focusDirections: [] },
  });
  const result = await activitySummaryStatement(db, 'u', '2026-09-16', '2026-09-16').all();
  assert.deepEqual(result.results, []);

  const ended = await endWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: 0, now: 1600 });
  await resetWorkday(db, { userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: ended.version, now: 1700 });
  assert.equal(await db.prepare(`SELECT value_json FROM user_settings WHERE user_id='u' AND setting_key=?1`).bind(`workday_plan:${started.id}`).first(), null);
  assert.equal(await readWorkdaySnapshot(db, 'u', '2026-09-16', 1800), null);
});

void test('REPORT-09 start endpoint snapshots current server goals and focus, not client input', async () => {
  const source = await readFile(new URL('../app/api/workday/route.ts', import.meta.url), 'utf8');
  assert.match(source, /readDashboardSnapshot\(env\.DB, user\.id, now\)/);
  assert.match(source, /dailyGoal: dashboard\.bookingGoal\.target/);
  assert.match(source, /monthlyGoal: dashboard\.monthlyBookingGoal/);
  assert.match(source, /focusDirections: dashboard\.focusDirections/);
});

void test('REPORT-09 UI switches from preview to immutable workday plan', async () => {
  const source = await readFile(new URL('../components/workday-card.tsx', import.meta.url), 'utf8');
  assert.match(source, /workday\?\.plan \?\?/);
  assert.match(source, /Зафіксовано на старті/);
  assert.match(source, /не зміняться заднім числом/);
  assert.match(source, /plan\.dailyGoal/);
  assert.match(source, /plan\.monthlyGoal/);
  assert.match(source, /plan\.focusDirections/);
});


void test('AD-17 refreshes only the unfinished workday focus and preserves published history', async (t) => {
  const db = await localDatabase(t);
  await seedChat(db, { id: 'published-chat', owner: 'u', platform: 'whatsapp', status: 'ready' });
  await db.prepare(`INSERT INTO chat_publications
    (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at)
    VALUES ('pub','u','published-chat','2026-09-20',1050,NULL,'manual','manual:pub',1050)`).run();

  const started = await startWorkday(db, {
    userId: 'u', today: '2026-09-20', now: 1000,
    plan: { dailyGoal: 5, monthlyGoal: 100, focusDirections: ['Англійська', 'Малювання'] },
  });
  const refreshed = await refreshWorkdayPlanFocus(db, {
    userId: 'u', id: started.id, workDate: started.workDate, expectedVersion: started.version,
    now: 1200, focusDirections: ['Англійська', 'Шахи', 'Програмування та IT'],
  });

  assert.equal(refreshed.version, 1);
  assert.deepEqual(refreshed.plan, {
    dailyGoal: 5, monthlyGoal: 100, focusDirections: ['Англійська', 'ІТ та шахи'], createdAt: 1200,
  });
  assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM chat_publications WHERE user_id='u'`).first()).count, 1);
  assert.equal((await db.prepare(`SELECT published_at FROM chat_publications WHERE id='pub'`).first()).published_at, 1050);
});

void test('AD-17 API refresh is owner/version scoped and reloads focus from server state', async () => {
  const source = await readFile(new URL('../app/api/workday/route.ts', import.meta.url), 'utf8');
  assert.match(source, /action === 'refresh-plan'/);
  assert.match(source, /readDashboardSnapshot\(env\.DB, user\.id, now\)/);
  assert.match(source, /refreshWorkdayPlanFocus\(env\.DB, \{ \.\.\.args, focusDirections: dashboard\.focusDirections \}\)/);
});
