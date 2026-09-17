import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('build identity is compiled from Git and exposed through a no-store endpoint', () => {
  const vite = read('vite.config.ts');
  const buildId = read('lib/build-id.ts');
  const route = read('app/api/build/route.ts');

  assert.match(vite, /git', \['rev-parse', 'HEAD'\]/);
  assert.match(vite, /__WORK_OS_BUILD_ID__:\s*JSON\.stringify\(buildId\)/);
  assert.match(buildId, /export const APP_BUILD_ID/);
  assert.match(route, /buildId:\s*APP_BUILD_ID/);
  assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
});

void test('automatic app update detects a new build and preserves user context', () => {
  const source = read('components/pwa-registration.tsx');

  assert.match(source, /const BUILD_POLL_MS = 30_000/);
  assert.match(source, /fetch\(`\/api\/build\?t=\$\{Date\.now\(\)\}`/);
  assert.match(source, /new BroadcastChannel\(UPDATE_CHANNEL\)/);
  assert.match(source, /isEditing\(\)/);
  assert.match(source, /sessionStorage\.setItem\(PENDING_BUILD_KEY, targetBuildId\)/);
  assert.match(source, /sessionStorage\.setItem\(UPDATE_SCROLL_KEY/);
  assert.match(source, /sessionStorage\.setItem\(UPDATE_VIEW_KEY, activeView\)/);
  assert.match(source, /restoreActiveView\(savedView\)/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /<output className="app-update-banner"/);
  assert.match(source, /app-update-backdrop/);
  assert.match(source, /exiting \? ' is-exiting' : ''/);
  assert.match(source, /Оновлюємо Work OS/);
  assert.match(source, /Work OS оновлено/);
});

void test('cross-device sync uses the existing monotonic backup revision as source of truth', () => {
  const revision = read('lib/sync-revision.ts');
  const route = read('app/api/sync/route.ts');
  const page = read('app/page.tsx');
  const hardening = read('migrations/0015_leads_hardening.sql');
  const workdays = read('migrations/0023_workdays.sql');

  assert.match(revision, /SELECT revision FROM backup_revisions WHERE user_id=\?1/);
  assert.match(route, /readSyncRevision\(env\.DB, user\.id\)/);
  assert.match(route, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
  assert.match(page, /readSyncRevision\(env\.DB, user\.id\)/);
  assert.match(page, /data-work-os-revision=\{syncRevision\}/);
  assert.match(page, /syncRevision=\{syncRevision\}/);
  assert.match(hardening, /CREATE TABLE backup_revisions/);
  assert.match(hardening, /backup_revision_chats_update/);
  assert.match(hardening, /backup_revision_leads_update/);
  assert.match(hardening, /backup_revision_daily_reports_update/);
  assert.match(hardening, /backup_revision_user_settings_update/);
  assert.match(workdays, /backup_revision_workdays_update/);
});

void test('global server sync refreshes only after authoritative revision changes', () => {
  const sync = read('components/server-sync.tsx');
  const clientSync = read('lib/client-sync.ts');
  const layout = read('app/layout.tsx');

  assert.match(sync, /const SERVER_SYNC_MS = 10_000/);
  assert.match(sync, /fetch\(`\/api\/sync\?t=\$\{Date\.now\(\)\}`/);
  assert.match(sync, /readRenderedRevision\(\)/);
  assert.match(sync, /pendingLocalAckRef/);
  assert.match(sync, /revision === previous/);
  assert.match(sync, /router\.refresh\(\)/);
  assert.match(sync, /new BroadcastChannel\(DATA_SYNC_CHANNEL\)/);
  assert.match(sync, /visibilitychange/);
  assert.match(sync, /window\.addEventListener\('online'/);
  assert.match(clientSync, /announceDataChange/);
  assert.match(clientSync, /reason: 'local-write'/);
  assert.match(layout, /<ServerSync \/>/);
});

void test('authoritative revision remounts data workspaces without resetting the shell', () => {
  const shell = read('components/work-os-shell.tsx');

  assert.match(shell, /syncRevision: number/);
  assert.match(shell, /<GlobalTimers key=\{`timers:\$\{syncRevision\}`\}/);
  assert.match(shell, /<PlatformWorkspace key=\{`platforms:\$\{syncRevision\}`\}/);
  assert.match(shell, /<LeadsWorkspace key=\{`leads:\$\{user\.email\}:\$\{syncRevision\}`\}/);
  assert.match(shell, /<AnalyticsWorkspace key=\{`analytics:\$\{syncRevision\}`\}/);
  assert.match(shell, /<ReportsWorkspace key=\{`reports:\$\{syncRevision\}`\}/);
  assert.match(shell, /<LibraryWorkspace key=\{`library:\$\{syncRevision\}`\}/);
  assert.match(shell, /<SettingsWorkspace key=\{`settings:\$\{syncRevision\}`\}/);
});

void test('lead writes broadcast fresh server state to other open clients', () => {
  const commands = read('lib/leads/client/commands.ts');
  assert.match(commands, /announceDataChange\('leads'\)/);
});

void test('automatic update UI has desktop, mobile and reduced-motion protection', () => {
  const css = read('app/design-polish.css');
  assert.match(css, /\.app-update-banner\s*\{/);
  assert.match(css, /\.app-update-backdrop\s*\{/);
  assert.match(css, /max-width:\s*none/);
  assert.match(css, /max-height:\s*none/);
  assert.match(css, /\.app-update-card\s*\{/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
