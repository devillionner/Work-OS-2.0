import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('build identity is compiled from Git and exposed through a no-store endpoint', () => {
  const vite = read('vite.config.ts'); const buildId = read('lib/build-id.ts'); const route = read('app/api/build/route.ts');
  assert.match(vite, /git', \['rev-parse', 'HEAD'\]/); assert.match(vite, /__WORK_OS_BUILD_ID__:\s*JSON\.stringify\(buildId\)/); assert.match(buildId, /export const APP_BUILD_ID/); assert.match(route, /buildId:\s*APP_BUILD_ID/); assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
});

void test('lead writes broadcast fresh server state to other open clients', () => { const commands = read('lib/leads/client/commands.ts'); assert.match(commands, /announceDataChange\('leads'\)/); });

void test('global sync refreshes every workspace when the Kyiv business date changes', () => {
  const sync = read('components/server-sync.tsx');
  assert.match(sync,/businessDateRef = useRef\(readKyivBusinessDate\(\)\)/);
  assert.match(sync,/timeZone: 'Europe\/Kyiv'/);
  assert.match(sync,/if \(refreshBusinessDay\(\)\) \{/);
  assert.match(sync,/router\.refresh\(\)/);
});

void test('sync never consumes a newer server revision when poll refresh is throttled', () => {
  const sync = read('components/server-sync.tsx');
  const throttle = sync.indexOf("if (reason === 'poll' && now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return 'changed';");
  const assign = sync.indexOf('revisionRef.current = revision;', throttle);
  assert.ok(throttle >= 0);
  assert.ok(assign > throttle);
  assert.match(sync,/pendingCheckRef\.current = reason/);
});

void test('local and cross-tab writes are replayed when a revision poll is already in flight', () => {
  const sync = read('components/server-sync.tsx');
  assert.match(sync,/pendingCheckRef = useRef<DataSyncDetail\['reason'\] \| null>\(null\)/);
  assert.match(sync,/if \(checkingRef\.current\) \{[\s\S]*reason !== 'poll'[\s\S]*pendingCheckRef\.current = reason/);
  assert.match(sync,/const pending = pendingCheckRef\.current;[\s\S]*window\.setTimeout\(\(\) => checkAgainRef\.current\?\.\(pending\), 0\)/);
});

