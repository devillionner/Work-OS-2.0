import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const componentsDir = join(root, 'components');
const componentFiles = readdirSync(componentsDir, { recursive: true })
  .filter((name) => typeof name === 'string' && name.endsWith('.tsx'))
  .map((name) => join(componentsDir, name));

function text(path) { return readFileSync(path, 'utf8'); }

void test('components never fall back to native browser alert, prompt or confirm', () => {
  const offenders = componentFiles.filter((path) => /window\.(?:alert|prompt|confirm)\s*\(|\b(?:alert|prompt)\s*\(/.test(text(path)));
  assert.deepEqual(offenders, []);
});

void test('shared dialog close controls stay localized and touch-target contract remains explicit', () => {
  const dialog = text(join(componentsDir, 'ui', 'dialog.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(dialog, /sr-only">\u0417\u0430\u043a\u0440\u0438\u0442\u0438<\/span>/);
  assert.match(css, /\[data-slot="dialog-close"\]\s*\{[^}]*min-width:44px;[^}]*min-height:44px;/s);
});

void test('closed mobile sidebar is removed from keyboard interaction until opened', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.work-sidebar \{[^}]*translateX\(-100%\)[^}]*visibility:hidden;[^}]*pointer-events:none;/s);
  assert.match(css, /\.work-sidebar\.is-open \{[^}]*translateX\(0\)[^}]*visibility:visible;[^}]*pointer-events:auto;/s);
});

void test('data-management UI avoids internal preview and staging-zone jargon', () => {
  for (const name of ['chat-csv-dialog.tsx', 'cloud-restore-dialog.tsx', 'legacy-import-dialog.tsx']) {
    const source = text(join(componentsDir, name));
    assert.doesNotMatch(source, />Preview</);
    assert.doesNotMatch(source, /staging-\u0437\u043e\u043d/);
  }
});


void test('user-facing source is free from mojibake and placeholder corruption', () => {
  const roots = ['app', 'components', 'lib', 'docs'];
  const offenders = [];
  for (const folder of roots) {
    const dir = join(root, folder);
    const files = readdirSync(dir, { recursive: true })
      .filter((name) => typeof name === 'string' && /\.(?:ts|tsx|md)$/.test(name))
      .map((name) => join(dir, name));
    for (const path of files) {
      if (/(?:Ð.|Ñ.|Ã.|Â.|â€|�|\?{4,})/.test(text(path))) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, []);
});

void test('app-specific native buttons always declare an explicit type', () => {
  const files = readdirSync(componentsDir, { recursive: true })
    .filter((name) => typeof name === 'string' && name.endsWith('.tsx') && !name.replaceAll('\\','/').startsWith('ui/'))
    .map((name) => join(componentsDir, name));
  const offenders = [];
  for (const path of files) {
    const source = text(path);
    for (const match of source.matchAll(/<button\b[^>]*>/gs)) {
      if (!/\btype\s*=/.test(match[0])) offenders.push(path);
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});

void test('mobile drawer moves focus into the drawer and isolates the background', () => {
  const shell = text(join(componentsDir, 'work-os-shell.tsx'));
  assert.match(shell, /mobileCloseRef\.current\?\.focus\(\)/);
  assert.match(shell, /mobileDrawerTriggerRef\.current/);
  assert.match(shell, /<main className="work-main" inert=\{mobileOpen \? true : undefined\}>/);
  assert.match(shell, /<h1 ref=\{pageHeadingRef\} tabIndex=\{-1\}>/);
});

void test('Telegram account creation field has an explicit accessible name', () => {
  const platform = text(join(componentsDir, 'platform-workspace.tsx'));
  assert.match(platform, /placeholder="Назва нового акаунта" aria-label="Назва нового Telegram-акаунта"/);
});

void test('daily report editor textarea has an explicit accessible name', () => {
  const source = text(join(componentsDir, 'reports-workspace.tsx'));
  assert.match(source, /<Textarea aria-label="\u0422\u0435\u043a\u0441\u0442 \u0449\u043e\u0434\u0435\u043d\u043d\u043e\u0433\u043e \u0437\u0432\u0456\u0442\u0443"/);
});

void test('chat history stays a secondary icon action in platform rows', () => {
  const source = text(join(componentsDir, 'platform-workspace.tsx'));
  assert.match(source, /aria-label="\u0406\u0441\u0442\u043e\u0440\u0456\u044f \u0447\u0430\u0442\u0443" title="\u0406\u0441\u0442\u043e\u0440\u0456\u044f \u0447\u0430\u0442\u0443"/);
  assert.doesNotMatch(source, />\u0406\u0441\u0442\u043e\u0440\u0456\u044f<\/Button>/);
});

void test('mobile topbar and drawer controls keep 44px touch targets', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.mobile-menu \{[^}]*width: 44px;[^}]*height: 44px;/s);
  assert.match(css, /\.sidebar-close-mobile, \.timer-trigger \{ min-width:44px; min-height:44px; \}/);
});

void test('mobile workflow form controls keep 44px touch targets', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.telegram-break-settings select, \.telegram-account-manager \[data-slot="input"\], \.telegram-account-manager \[data-slot="button"\] \{ min-height:44px; \}/);
  assert.match(css, /\.reports-editor-actions > button, \.reports-editor-actions > select, \.reports-editor-actions \[data-slot="input"\] \{ min-height:44px; \}/);
  assert.match(css, /\.report-correction-fields select \{ min-height:44px; \}/);
});

void test('Telegram scheduler has responsive workspace styling', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.telegram-schedule-controls \{ display:grid;/);
  assert.match(css, /\.telegram-schedule-slots article \{ display:grid;/);
  assert.match(css, /\.telegram-warmup-steps li \{ display:grid;/);
  assert.match(css, /\.telegram-slot-time,\.telegram-schedule-slots select \{ min-height:42px;/);
  assert.match(css, /\.telegram-slot-time,\.telegram-schedule-slots select[^}]*min-height:44px/s);
  assert.match(text(join(componentsDir, 'telegram-schedule.tsx')), /<label key=\{chat\.id\} className="telegram-schedule-chat-option">/);
});

void test('global timer controls meet desktop and mobile target sizes', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.timer-popover header > button, \.timer-row > button \{ width: 42px; height: 42px;/);
  assert.match(css, /\.timer-create select \{ min-height: 42px;/);
  assert.match(css, /\.timer-durations button \{ min-height: 42px;/);
  assert.match(css, /\.timer-create select, \.timer-create \[data-slot="button"\] \{ min-width:44px; min-height:44px; \}/);
});

void test('Leads mobile workspace keeps core CRM controls touch friendly', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.lead-mobile-back \{ position:sticky; top:8px;[^}]*min-height:44px|\.lead-mobile-back[^}]*min-height:44px/s);
  assert.match(css, /\.lead-filters \[data-slot="button"\] \{ flex:1 1 100px; \}/);
  assert.match(css, /\.lead-list-item \{ min-height:72px;/);
  assert.match(css, /\.lead-dialog \[data-slot="native-select"\][^}]*min-height:44px/s);
});

void test('Reports mobile flow keeps calendar, checkpoints, history and corrections touch friendly', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.report-mobile-back \{ display:inline-flex; position:sticky; top:8px;[^}]*min-height:44px;/);
  assert.match(css, /\.reports-month-head \[data-slot="button"\] \{ min-width:44px; min-height:44px; \}/);
  assert.match(css, /\.report-checkpoint-actions \[data-slot="button"\] \{ min-height:44px;/);
  assert.match(css, /\.report-history-dialog \[data-slot="button"\], \.report-correction-dialog \[data-slot="button"\][^}]*min-height:44px;/);
  for (const file of ['report-chat-correction.tsx','report-publication-correction.tsx','report-lesson-result-correction.tsx']) assert.match(text(join(componentsDir, file)), /<DialogContent className="report-correction-dialog">/);
});
