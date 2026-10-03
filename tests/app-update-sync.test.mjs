import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('build identity is compiled from Git and exposed through a no-store endpoint', () => {
  const vite = read('vite.config.ts'); const buildId = read('lib/build-id.ts'); const route = read('app/api/build/route.ts');
  assert.match(vite, /git', \['rev-parse', 'HEAD'\]/); assert.match(vite, /__WORK_OS_BUILD_ID__:\s*JSON\.stringify\(buildId\)/); assert.match(buildId, /export const APP_BUILD_ID/); assert.match(route, /buildId:\s*APP_BUILD_ID/); assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
});

void test('automatic app update detects a new build and preserves user context', () => {
  const source = read('components/pwa-registration.tsx');
  assert.match(source, /const BUILD_POLL_MS = 30_000/); assert.match(source, /fetch\(`\/api\/build\?t=\$\{Date\.now\(\)\}`/); assert.match(source, /new BroadcastChannel\(UPDATE_CHANNEL\)/); assert.match(source, /isEditing\(\)/); assert.match(source, /sessionStorage\.setItem\(PENDING_BUILD_KEY, targetBuildId\)/); assert.match(source, /sessionStorage\.setItem\(UPDATE_SCROLL_KEY/); assert.match(source, /sessionStorage\.setItem\(UPDATE_VIEW_KEY, activeView\)/); assert.match(source, /restoreActiveView\(savedView\)/); assert.match(source, /window\.location\.reload\(\)/); assert.match(source, /<output className="app-update-banner"/); assert.match(source, /app-update-backdrop/); assert.match(source, /is-exiting/); assert.match(source, /Оновлюємо Work OS/); assert.match(source, /Work OS оновлено/);
});

void test('update handoff uses one branded status object and a deliberate exit', () => {
  const source = read('components/pwa-registration.tsx'); const motion = read('app/update-motion.css');
  assert.match(source, /const UPDATE_EXIT_MS = 620/);
  assert.match(source, /className="app-update-status-mark"/);
  assert.match(source, /className="app-update-status-brand">W<\/span>/);
  assert.doesNotMatch(source, /className="app-update-brand"/);
  assert.match(motion, /--app-update-exit-duration:\s*620ms/);
  assert.match(motion, /\.app-update-status-mark\s*\{/);
  assert.match(motion, /\.app-update-status-mark::after\s*\{/);
  assert.match(motion, /border-radius:\s*50%/);
  assert.match(motion, /\.app-update-backdrop\.is-exiting/);
  assert.match(motion, /background-color:\s*rgb\(245 246 248 \/ 0\)/);
});

void test('cross-device sync uses the existing monotonic backup revision as source of truth', () => {
  const revision = read('lib/sync-revision.ts'); const route = read('app/api/sync/route.ts'); const page = read('app/api/dashboard-bootstrap/route.ts'); const bootstrap = read('components/work-os-bootstrap.tsx'); const hardening = read('migrations/0015_leads_hardening.sql'); const workdays = read('migrations/0023_workdays.sql');
  assert.match(revision, /SELECT revision FROM backup_revisions WHERE user_id=\?1/); assert.match(route, /readSyncRevision\(env\.DB, user\.id\)/); assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/); // Home SSR only authenticates; the revision comes with the JSON bootstrap and is rendered by WorkOsBootstrap.
  assert.match(page, /readSyncRevision\(env\.DB, user\.id\)/); assert.match(bootstrap, /data-work-os-revision=\{payload\.syncRevision\}/); assert.match(bootstrap, /syncRevision=\{payload\.syncRevision\}/); assert.match(hardening, /CREATE TABLE backup_revisions/); assert.match(hardening, /backup_revision_chats_update/); assert.match(hardening, /backup_revision_leads_update/); assert.match(hardening, /backup_revision_daily_reports_update/); assert.match(hardening, /backup_revision_user_settings_update/); assert.match(workdays, /backup_revision_workdays_update/);
});

void test('global server sync refreshes only after authoritative revision changes', () => {
  const sync = read('components/server-sync.tsx'); const clientSync = read('lib/client-sync.ts'); const layout = read('app/layout.tsx');
  assert.match(sync, /const SERVER_SYNC_ACTIVE_MS = 10_000/); assert.match(sync, /const SERVER_SYNC_IDLE_MIN_MS = 30_000/); assert.match(sync, /const SERVER_SYNC_IDLE_MAX_MS = 60_000/); assert.match(sync, /const SERVER_SYNC_ERROR_MAX_MS = 300_000/); assert.doesNotMatch(sync, /setInterval/); assert.match(sync, /fetch\(`\/api\/sync\?t=\$\{Date\.now\(\)\}`/); assert.match(sync, /readRenderedRevision\(\)/); assert.doesNotMatch(sync, /pendingLocalAckRef/); assert.match(sync, /revision === previous/); assert.match(sync, /detail\?\.reason === 'local-write'\) scheduleWake\('cross-tab', detail\.scope \?\? 'all'\)/); assert.match(sync, /router\.refresh\(\)/); assert.match(sync, /new BroadcastChannel\(DATA_SYNC_CHANNEL\)/); assert.match(sync, /visibilitychange/); assert.match(sync, /window\.addEventListener\('online'/); assert.match(sync, /DATA_SYNC_REQUEST_EVENT/); assert.match(sync, /onSyncRequest/); assert.match(clientSync, /announceDataChange/); assert.match(clientSync, /requestDataSync/); assert.match(clientSync, /DATA_SYNC_REQUEST_EVENT/); assert.match(layout, /<ServerSync \/>/);
});

void test('authoritative revision refreshes persistent workspaces without remount keys', () => {
  const shell = read('components/work-os-shell.tsx');
  const platform = read('components/platform-workspace.tsx');
  assert.match(shell, /<PlatformWorkspace enabledPlatforms=\{snapshot\.enabledPlatforms\} syncRevision=\{syncRevision\} businessDate=\{snapshot\.today\} active=\{activeView === 'platforms'\} \/>/);
  assert.match(shell, /<AnalyticsWorkspace syncRevision=\{syncRevision\} active=\{activeView === 'analytics'\} \/>/);
  assert.match(shell, /<ReportsWorkspace syncRevision=\{syncRevision\} active=\{activeView === 'reports'\}/);
  assert.match(shell, /<LibraryWorkspace syncRevision=\{syncRevision\} active=\{activeView === 'library'\} \/>/);
  assert.doesNotMatch(shell, /(?:PlatformWorkspace|AnalyticsWorkspace|ReportsWorkspace|LibraryWorkspace) key=/);
  assert.match(platform, /const lastSyncKey=useRef\(`\$\{syncRevision \?\? ''\}:\$\{businessDate \?\? ''\}`\)/);
  assert.match(platform, /\[syncRevision,businessDate,platform,loadAccounts,invalidateQueueCache,active\]/);
});

void test('lead writes broadcast fresh server state to other open clients', () => { const commands = read('lib/leads/client/commands.ts'); assert.match(commands, /announceDataChange\('leads'\)/); });

void test('automatic update UI has desktop, mobile and reduced-motion protection', () => {
  const css = read('app/design-polish.css'); const motion = read('app/update-motion.css');
  assert.match(css, /\.app-update-banner\s*\{/); assert.match(css, /\.app-update-backdrop\s*\{/); assert.match(css, /max-width:\s*none/); assert.match(css, /max-height:\s*none/); assert.match(css, /\.app-update-card\s*\{/); assert.match(css, /@media \(max-width: 520px\)/); assert.match(css, /@media \(prefers-reduced-motion: reduce\)/); assert.match(motion, /\.app-update-backdrop\.is-exiting/); assert.match(motion, /app-update-card-enter/); assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
});


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
  assert.match(sync,/const pending = pendingCheckRef\.current;[\s\S]*window\.setTimeout\(\(\) => void checkRevision\(pending\), 0\)/);
});


void test('returning to Today requests a revision check instead of forcing an RSC refresh', () => {
  const shell=read('components/work-os-shell.tsx');
  assert.match(shell,/if \(next === 'today' && activeView !== 'today'\) requestDataSync\('focus'\)/);
  const start=shell.indexOf('const navigateTo');
  const end=shell.indexOf('const orderedLeadTasks',start);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(shell.slice(start,end),/router\.refresh\(\)/);
});
