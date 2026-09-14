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
    assert.doesNotMatch(source, /\u043e\u0431\u043e\u0432.\u044f\u0437\u043a\u043e\u0432\u0438\u0439 preview|\u0447\u0435\u0440\u0435\u0437 staging/i);
  }
  assert.doesNotMatch(text(join(componentsDir, 'work-os-shell.tsx')), /follow-up/i);
  assert.doesNotMatch(text(join(componentsDir, 'report-lesson-result-correction.tsx')), /CRM lifecycle|version guard/i);
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

void test('Library workspace uses scoped desktop and mobile interaction targets', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.library-kind-picker button \{ min-height: 42px;/);
  assert.match(css, /\.library-search input \{ min-height:42px;/);
  assert.match(css, /\.library-mobile-back \{ display:inline-flex; position:sticky; top:8px;[^}]*min-height:44px;/);
  assert.match(css, /\.library-hero \[data-slot="button"\], \.library-toolbar > \[data-slot="button"\][^}]*min-height:44px;/);
  assert.match(css, /\.library-history-dialog summary \{ min-height:44px;/);
});

void test('Settings and Analytics interaction layer uses scoped targets and keyboard focus', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.range-picker button \{ min-height: 42px;/);
  assert.match(css, /\.analytics-custom-range input \{ min-height:42px;/);
  assert.match(css, /\.platform-settings-list label \{ min-height:42px;/);
  assert.match(css, /\.platform-settings-list input \{ width:18px; height:18px;/);
  assert.match(css, /\.settings-panel-primary \.card-heading \[data-slot="button"\][^}]*min-height:42px;/s);
  assert.match(css, /\.analytics-custom-range input \{ width:100%; min-height:44px; \}/);
  assert.match(css, /\.platform-settings-list label:has\(input:focus-visible\)/);
});

void test('Today dashboard keeps primary work controls readable and touch friendly', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.focus-actions \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.text-action \{ min-height:42px;/);
  assert.match(css, /\.workday-actions \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.direction-checks label \{ min-height:42px;/);
  assert.match(css, /\.workday-card \{ display:grid; grid-template-columns:44px minmax\(0,1fr\); padding:19px 16px; \}/);
  assert.match(css, /\.focus-actions \[data-slot="button"\][^}]*min-height:44px;/s);
  assert.match(css, /\.platform-table-head, \.platform-row \{ min-width:520px;/);
  assert.match(css, /\.text-action:focus-visible \{ outline:3px solid var\(--ring\);/);
});

void test('Platform daily workflow uses desktop-sized controls and keyboard focus', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.platform-picker button \{ min-height: 42px;/);
  assert.match(css, /\.telegram-account-tabs > button:not\(\[class\]\)[^}]*min-height: 42px;/);
  assert.match(css, /\.telegram-break-settings select \{ min-height: 42px;/);
  assert.match(css, /\.telegram-account-manager \[data-slot="input"\], \.telegram-account-manager \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.chat-toolbar input \{ min-height:42px;/);
  assert.match(css, /\.chat-actions \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.platform-picker button:focus-visible, \.telegram-account-tabs > button:not\(\[class\]\):focus-visible, \.queue-tabs button:focus-visible/);
});

void test('Workspace native controls share desktop targets and visible keyboard focus', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.account-link \{ min-height:42px;/);
  assert.match(css, /\.timer-trigger \{ min-height: 42px;/);
  assert.match(css, /\.archive-reasons button \{ min-height:42px;/);
  assert.match(css, /\.report-history-list summary \{ min-height:42px;/);
  assert.match(css, /\.chat-publish-items button \{ min-height:48px;/);
  assert.match(css, /\.dialog-actions \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /:is\(\.today-settings-dialog,\.chat-bulk-dialog,[^}]*\[data-slot="button"\][^}]*min-height:42px;/s);
  assert.match(css, /\.dialog-actions \[data-slot="button"\],[^}]*min-height:44px;/s);
  assert.match(css, /\.timer-trigger:focus-visible,[\s\S]*\.library-item:focus-visible,[\s\S]*\.report-disclosure > summary:focus-visible/);
});

void test('Remaining workspace controls meet final sizing and mobile nav readability targets', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.chat-account-select \{[^}]*min-height: 42px;/);
  assert.match(css, /\.archive-custom input \{ min-height: 42px;/);
  assert.match(css, /\.archive-custom \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.report-form-link \{[^}]*min-height:42px;/);
  assert.match(css, /\.mobile-bottom-nav button \{[^}]*font-size: 10px;/);
  assert.match(css, /\.mobile-bottom-nav button\[aria-current='page'\] \{ background:#eef2ff;/);
  assert.match(css, /\.archive-custom input, \.archive-custom \[data-slot="button"\] \{ min-height:44px; \}/);
  assert.match(css, /--muted-foreground: #69707d;/);
  assert.doesNotMatch(css, /color:\s*#(?:7b8190|747a88|8b909b|747986|7b818d|858b96|767c88|787e89|868b96|7c8390|727987|737986|777e8b|747b87|7a818e|737a88)\b/i);
});

void test('Mobile shell respects iPhone safe areas and sticky navigation offsets', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.topbar \{ position:sticky; top:0; z-index:15; height:calc\(78px \+ env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.work-sidebar \{[^}]*padding-top:calc\(18px \+ env\(safe-area-inset-top\)\);[^}]*padding-bottom:calc\(18px \+ env\(safe-area-inset-bottom\)\);/s);
  assert.match(css, /\.timer-popover \{ position:fixed; inset:calc\(82px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.lead-mobile-back, \.library-mobile-back, \.report-mobile-back \{[\s\S]*top: calc\(86px \+ env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.import-dialog > \[data-slot="dialog-header"\] \{ padding:calc\(18px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.import-dialog \.import-actions \{ padding:16px max\(18px,env\(safe-area-inset-right\)\) calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.dashboard-grid \{ grid-template-columns:minmax\(0,1fr\); padding:16px 14px calc\(92px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /\.platform-workspace \{ padding:14px 12px calc\(88px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /\.leads-workspace \{ padding-bottom:calc\(100px \+ env\(safe-area-inset-bottom\)\);/);
});

void test('User-facing copy avoids implementation jargon in operator workflows', () => {
  const analytics = text(join(componentsDir, 'analytics-workspace.tsx'));
  const csv = text(join(componentsDir, 'chat-csv-dialog.tsx'));
  const restore = text(join(componentsDir, 'cloud-restore-dialog.tsx'));
  const correction = text(join(componentsDir, 'report-chat-correction.tsx'));
  const conversation = text(join(componentsDir, 'leads', 'conversation.tsx'));
  const libraryHistory = text(join(componentsDir, 'library-history-dialog.tsx'));
  assert.doesNotMatch(analytics, /Когортна атрибуція|source chat/);
  assert.doesNotMatch(csv, /канонічні посилання/);
  assert.doesNotMatch(restore, />JSON до 25 МБ · без запису в базу<|· SHA \{/);
  assert.doesNotMatch(correction, /join-streak|joined_at|події chat_joined/);
  assert.doesNotMatch(conversation, /CRM-історія/);
  assert.doesNotMatch(libraryHistory, /Показати snapshot/);
});

void test('Dynamic workspace errors are announced to assistive technology', () => {
  for (const name of ['platform-workspace.tsx', 'report-checkpoints.tsx', 'telegram-schedule.tsx', 'today-settings-dialog.tsx']) {
    const source = text(join(componentsDir, name));
    assert.match(source, /className="workspace-error" role="alert"/);
  }
});

void test('ARIA tablists use roving tab stops and arrow-key navigation', () => {
  const library = text(join(componentsDir, 'library-workspace.tsx'));
  const platform = text(join(componentsDir, 'platform-workspace.tsx'));
  assert.match(library, /role="tab"[^>]*tabIndex=\{collection===value\?0:-1\}[^>]*onKeyDown=\{handleTabKeyNavigation\}/);
  assert.match(platform, /role="tab"[^>]*tabIndex=\{platform===item\.key\?0:-1\}[^>]*onKeyDown=\{handleTabKeyNavigation\}/);
  assert.match(platform, /role="tab"[^>]*tabIndex=\{queue===item\.key\?0:-1\}[^>]*onKeyDown=\{handleTabKeyNavigation\}/);
});

void test('Mobile workday card switches to grid before placing full-width actions', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.workday-card \{ display:grid; grid-template-columns:44px minmax\(0,1fr\); padding:19px 16px; \}/);
  assert.match(css, /\.workday-card > \.workday-actions \{ grid-column:1\/-1; width:100%; margin-left:0; \}/);
});

void test('Today dashboard adapts before the fixed sidebar makes tiled desktop content too narrow', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.dashboard-grid \{ grid-template-columns: 1fr; padding: clamp\(20px, 3vw, 32px\); \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.analytics-workspace \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.focus-card \{ display:grid; gap:20px; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.focus-actions \{ justify-content:flex-start; flex-wrap:wrap; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.analytics-metrics \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.reports-layout \{ grid-template-columns:1fr; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.settings-grid \{ grid-template-columns:1fr; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.analytics-hero, \.reports-hero \{ display:grid; grid-template-columns:minmax\(0,1fr\); align-items:start; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.analytics-controls \{ min-width:0; width:100%; justify-content:flex-start; \}/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.range-picker \{ max-width:100%; overflow-x:auto; scrollbar-width:none; \}/);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1180px\) \{[\s\S]*?\.settings-primary-grid \{ grid-template-columns:1fr; gap:14px; \}/);
});

void test('Report calendar keeps full accessible context while visually compacting dense day labels', () => {
  const context = text(join(componentsDir, 'report-calendar-context.tsx'));
  const reports = text(join(componentsDir, 'reports-workspace.tsx'));
  assert.match(context, /compact\.slice\(0, 2\)/);
  assert.match(context, /title=\{labels\.join\(' · '\)\} aria-hidden="true"/);
  assert.match(reports, /aria-label=\{`\$\{formatDate\(day\.date\)\}\. \$\{calendarContextLabels\(day\.date, context\)\.join\(', '\) \|\| 'Без подій'\}/);
});

void test('Intermediate desktop uses single-pane master detail before sidebars squeeze Leads and Library', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /@media\(max-width:1024px\) \{[\s\S]*?\.leads-layout \{ grid-template-columns:1fr; gap:12px; \}/);
  assert.match(css, /@media\(max-width:1024px\) \{[\s\S]*?\.leads-workspace\.has-selection \.leads-list \{ display:none; \}/);
  assert.match(text(join(componentsDir, 'leads', 'workspace.tsx')), /matchMedia\('\(max-width: 1024px\)'\)/);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1024px\) \{[\s\S]*?\.library-layout \{ grid-template-columns:1fr; gap:12px; \}/);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1024px\) \{[\s\S]*?\.library-workspace\.has-editor \.library-list \{ display:none; \}/);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1024px\) \{[\s\S]*?\.library-workspace:not\(\.has-editor\) \.library-editor \{ display:none; \}/);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1024px\) \{[\s\S]*?\.library-toolbar \{ align-items:stretch; flex-direction:column; \}/);
});

void test('Narrow mobile workspaces constrain intrinsic grid tracks instead of widening the document', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.dashboard-grid \{ grid-template-columns:minmax\(0,1fr\);/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.focus-card \{ min-width:0; display: grid;/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.reports-workspace \{ grid-template-columns:minmax\(0,1fr\);/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.reports-layout \{ min-width:0; grid-template-columns:minmax\(0,1fr\);/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.reports-weekdays, \.reports-calendar-grid \{ grid-template-columns:repeat\(7,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?\.report-day \{ min-width:0; min-height: 42px; \}/);
});

void test('Leads workspace shares the primary workspace hero hierarchy', () => {
  const workspace = text(join(componentsDir, 'leads', 'workspace.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(workspace, /<section className="leads-hero">[\s\S]*?<p className="eyebrow">CRM та супровід<\/p>[\s\S]*?<h2>Контакти, учні та уроки<\/h2>/);
  assert.match(css, /\.leads-workspace \{ max-width:1400px; display:grid; gap:18px; margin:0 auto; padding:clamp\(22px,4vw,54px\); \}/);
  assert.match(css, /\.leads-hero \{ display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:26px; background:linear-gradient\(115deg,#fff 0%,#fff 58%,#eef2ff 100%\); \}/);
});
