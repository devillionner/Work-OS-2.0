import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/workday/route.ts', import.meta.url), 'utf8');
const card = readFileSync(new URL('../components/workday-card.tsx', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../app/design-polish.css', import.meta.url), 'utf8');

void test('workday exposes an uncached authenticated server snapshot for cross-device sync', () => {
  assert.match(route, /export async function GET\(\): Promise<Response>/);
  assert.match(route, /readWorkdaySnapshot\(env\.DB, user\.id, today, now\)/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});

void test('workday card refreshes remote state while visible and when returning to the tab', () => {
  assert.match(card, /const SYNC_INTERVAL_MS = 5_000/);
  assert.match(card, /fetch\('\/api\/workday',[\s\S]*method: 'GET',[\s\S]*cache: 'no-store'/);
  assert.match(card, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(card, /window\.addEventListener\('focus', onFocus\)/);
  assert.match(card, /new BroadcastChannel\(SYNC_CHANNEL\)/);
});

void test('workday mutations broadcast changes and recover from stale cross-device versions', () => {
  assert.match(card, /channelRef\.current\?\.postMessage\(\{ type: 'workday-changed', version: result\.workday\.version \}\)/);
  assert.match(card, /refreshAfter = response\.status === 409/);
  assert.match(card, /if \(refreshAfter\) void refreshWorkday\(\)/);
});

void test('ended current workday reset is explicit, confirmed, destructive and server guarded', () => {
  assert.match(route, /action === 'reset'/);
  assert.match(route, /workDate !== today/);
  assert.match(route, /resetWorkday\(env\.DB, args\)/);
  assert.match(route, /workday: null, today/);
  assert.match(card, /workday\?\.status === 'ended' && workday\.workDate === currentToday/);
  assert.match(card, /confirmLabel="Скинути день"/);
  assert.match(card, /destructive/);
  assert.match(card, /void mutate\('reset'\)/);
});

void test('workday status and actions use stable responsive slots', () => {
  assert.match(card, /className="workday-main"/);
  assert.match(card, /className="workday-heading"/);
  assert.match(card, /className="workday-status"/);
  assert.match(card, /className="workday-actions"/);
  assert.doesNotMatch(card, /workday-actions[\s\S]{0,400}<Badge/);

  assert.match(polish, /\.workday-card \{[\s\S]*grid-template-columns: 44px minmax\(0, 1fr\)/);
  assert.match(polish, /\.workday-card > \.workday-actions \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*width: 100%/);
  assert.match(polish, /@media \(max-width: 640px\)[\s\S]*\.workday-heading \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(polish, /@media \(max-width: 640px\)[\s\S]*\.workday-card > \.workday-actions \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});
