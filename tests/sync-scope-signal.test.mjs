import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Commit 2 (light version): the global backup_revisions-driven /api/sync stays as the cross-device
// "did anything change" signal (full per-scope D1 revisions are deferred to the commit 3 path->scope
// map so the work isn't duplicated), but same-tab/cross-tab local-write signals already know their
// exact scope at the call site, so they must reach listeners precisely instead of collapsing to 'all'.
void test('local-write/cross-tab signals carry and merge a specific scope instead of always announcing all', () => {
  const sync = read('components/server-sync.tsx');
  const clientSync = read('lib/client-sync.ts');
  assert.match(clientSync, /revision\?: number;/);
  assert.match(sync, /function mergeScope\(current: DataSyncScope \| null, next: DataSyncScope\): DataSyncScope \{/);
  assert.match(sync, /if \(current === null \|\| current === next\) return next;/);
  assert.match(sync, /return 'all';/);
  assert.match(sync, /const checkRevision = useCallback\(async \(reason: DataSyncDetail\['reason'\], scope: DataSyncScope = 'all'\)/);
  assert.match(sync, /const detail: DataSyncDetail = \{ scope, reason, at: now, revision \};/);
  assert.match(sync, /const wake = \(reason: DataSyncDetail\['reason'\], scope: DataSyncScope = 'all'\) => \{/);
  assert.match(sync, /void checkRevision\(reason, scope\)/);
  assert.match(sync, /scheduleWake\('cross-tab', detail\.scope \?\? 'all'\)/);
  assert.match(sync, /scheduleWake\('cross-tab', event\.data\?\.scope \?\? 'all'\)/);
});

void test('rapid local-write/cross-tab signals are coalesced within one window, not checked once each', () => {
  const sync = read('components/server-sync.tsx');
  assert.match(sync, /const WAKE_COALESCE_MS = 3_000;/);
  assert.match(sync, /wakeScope = mergeScope\(wakeScope, scope\);/);
  assert.match(sync, /if \(wakeTimer !== null\) window\.clearTimeout\(wakeTimer\);/);
  assert.match(sync, /wakeTimer = window\.setTimeout\(\(\) => \{/);
});

// Before this fix, WorkOsBootstrap fetched /api/dashboard-bootstrap exactly once at mount ([attempt]
// only changes from the manual retry button) and never again, so its syncRevision prop — threaded
// into every workspace — was frozen for the whole tab session. router.refresh() re-rendering the
// Server Component page did nothing for it, since React preserves client state across an unrelated
// parent re-render. Cross-device/other-tab freshness for Platforms/Leads/Library/Reports/Analytics
// therefore never actually reached those workspaces; only the tab that made a local write refreshed,
// via its own direct reload call, independent of this prop.
void test('WorkOsBootstrap listens for sync signals instead of freezing syncRevision at mount forever', () => {
  const bootstrap = read('components/work-os-bootstrap.tsx');
  assert.match(bootstrap, /import \{ DATA_SYNC_EVENT, type DataSyncDetail \} from '@\/lib\/client-sync';/);
  assert.match(bootstrap, /const onDataSync = \(event: Event\) => \{/);
  assert.match(bootstrap, /if \(detail\.scope === 'dashboard' \|\| detail\.scope === 'all'\) \{/);
  assert.match(bootstrap, /void reloadSnapshot\(\);/);
  assert.match(bootstrap, /setPayload\(\{ \.\.\.current, syncRevision: detail\.revision as number \}\);/);
  assert.match(bootstrap, /window\.addEventListener\(DATA_SYNC_EVENT, onDataSync\);/);
});

void test('platform mutations announce their own scope instead of the broad all', () => {
  const workspace = read('components/platform-workspace.tsx');
  assert.doesNotMatch(workspace, /announceDataChange\('all'\)/);
  assert.match(workspace, /announceDataChange\('platforms'\)/);
  const matches = workspace.match(/announceDataChange\('platforms'\)/g) || [];
  assert.equal(matches.length, 5, 'all five platform mutation sites should announce the platforms scope');
});
