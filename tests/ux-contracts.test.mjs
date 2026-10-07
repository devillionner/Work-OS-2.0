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

void test('shared dialog close controls stay localized, deduplicate state transitions and keep touch targets explicit', () => {
  const dialog = text(join(componentsDir, 'ui', 'dialog.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(dialog, /sr-only">\u0417\u0430\u043a\u0440\u0438\u0442\u0438<\/span>/);
  assert.match(dialog, /lastOpenRef = React\.useRef/);
  assert.match(dialog, /if \(lastOpenRef\.current === open\) return;/);
  assert.match(dialog, /if \(props\.open !== undefined\) lastOpenRef\.current = props\.open;/);
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

void test('Platforms uses a compact operator hierarchy and an unambiguous publication CTA', () => {
  const workspace = text(join(componentsDir, 'platform-workspace.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(workspace, /<section className="platform-header">/);
  assert.match(workspace, /<PlatformOverview pace=\{data\.publicationPace\}/);
  assert.match(workspace, /className=\{(`|')platform-queue-context/);
  assert.match(workspace, /if\(canPublish\(chat,clock\)\)return 'Підготувати';/);
  assert.match(workspace, /\{compactChatLink\(chat\.link\)\}/);
  assert.match(workspace, /className="chat-action-utilities"/);
  assert.match(workspace, /chat\.publishedToday\?'is-published'/);
  assert.doesNotMatch(workspace, /return 'Готово'/);
  assert.doesNotMatch(workspace, /className="platform-hero"|today-links|quick-publish-bar|posting-pace/);
  assert.match(css, /\.platform-overview \{ display:grid;/);
  assert.match(css, /\.platform-workspace \{[^}]*container-type:inline-size; container-name:platform-workspace;/);
  assert.match(css, /@container platform-workspace \(max-width:900px\)[\s\S]*\.platform-overview \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /\.platform-queue-context \{ display:flex;/);
  assert.match(css, /\.chat-action-utilities \{ display:flex;/);
  assert.match(css, /\.chat-row\.is-published \{ background:var\(--surface-subtle\); \}/);
  assert.match(css, /\.queue-tabs button\[aria-selected='true'\] \{ background: var\(--card\); color:var\(--accent-foreground\);/);
  assert.doesNotMatch(css, /\.today-links|\.quick-publish-bar|\.posting-pace/);
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

void test('Platform queue adapts to its own width without compressing or overlapping chat rows', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.platform-browser \{[^}]*container-type:inline-size; container-name:platform-browser;/);
  assert.match(css, /\.chat-list \{ display:grid; grid-auto-rows:max-content; align-content:start; \}/);
  assert.match(css, /@container platform-browser \(max-width: 820px\)[\s\S]*\.chat-row \{ grid-template-columns:minmax\(0,1fr\); grid-auto-rows:max-content; align-items:start; gap:10px; min-height:0; \}/);
  assert.match(css, /@container platform-browser \(max-width: 820px\)[\s\S]*\.chat-actions \{ width:100%; min-width:0; flex-wrap:wrap; justify-content:flex-start; align-items:stretch; gap:8px; \}/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.queue-tabs \{ display:flex; overflow-x:auto;[^}]*scrollbar-width:none; \}/);
  assert.match(css, /\.platform-browser \.chat-list \{ flex:1 1 auto; min-height:0; overflow:auto;/);
});

void test('Platform archive reason picker is modal and cannot overlap the next chat row', () => {
  const workspace = text(join(componentsDir, 'platform-workspace.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(workspace, /<Dialog open=\{archiveChat!==null\}/);
  assert.match(workspace, /<fieldset className="archive-dialog-reasons">/);
  assert.match(workspace, /<legend className="sr-only">Причина архівації<\/legend>/);
  assert.doesNotMatch(workspace, /role="group"/);
  assert.doesNotMatch(workspace, /archiveId===chat\.id&&<div className="archive-reasons"/);
  assert.match(css, /\.archive-dialog-reasons \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\);[^}]*border:0;/);
});

void test('Platform mutations and sync revisions reconcile without remounting or blanking the queue', () => {
  const workspace = text(join(componentsDir, 'platform-workspace.tsx'));
  const shell = text(join(componentsDir, 'work-os-shell.tsx'));
  const loadStart = workspace.indexOf('const load = useCallback');
  const loadEnd = workspace.indexOf('useEffect(() => { reloadChats.current=load', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const loadBlock = workspace.slice(loadStart, loadEnd);
  assert.doesNotMatch(loadBlock, /setData\(null\)/);
  assert.match(workspace, /const load = useCallback\(async \(silent=false\)/);
  assert.match(workspace, /const viewCache=useRef\(new Map<string,ResponseData>\(\)\)/);
  assert.match(workspace, /const cachedData=viewCache\.current\.get\(requestKey\)\|\|null/);
  assert.match(workspace, /const data=loadedData\?\.requestKey===requestKey\?loadedData:cachedData/);
  assert.doesNotMatch(workspace, /prefetching|cacheEpoch/);
  assert.doesNotMatch(loadBlock, /for\(const item of queues\)[\s\S]*fetch\(`\/api\/chats/);
  assert.match(workspace, /invalidateQueueCache\(chat\.platform\)/);
  assert.match(workspace, /await reloadChats\.current\(true\)/);
  assert.match(workspace, /syncRevision\?: number/);
  assert.doesNotMatch(workspace, /router\.refresh\(\)/);
  assert.doesNotMatch(workspace, /useRouter/);
  assert.match(shell, /<PlatformWorkspace enabledPlatforms=\{snapshot\.enabledPlatforms\} syncRevision=\{syncRevision\} businessDate=\{snapshot\.today\} active=\{activeView === 'platforms'\} \/>/);
  assert.doesNotMatch(shell, /<PlatformWorkspace key=/);
  assert.match(workspace, /!data&&\(loading\|\|switchingList\) \? <WorkspaceInitialLoading compact/);
});

void test('Workspace native controls share desktop targets and visible keyboard focus', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.account-link \{ min-height:42px;/);
  assert.match(css, /\.timer-trigger \{ min-height: 42px;/);
  assert.match(css, /\.archive-dialog-reasons \[data-slot="button"\] \{ min-height:42px;/);
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
  assert.match(css, /\.archive-dialog-custom input \{ min-height:42px;/);
  assert.match(css, /\.archive-dialog-custom \[data-slot="button"\] \{ min-height:42px; \}/);
  assert.match(css, /\.report-form-link \{[^}]*min-height:42px;/);
  assert.match(css, /\.mobile-bottom-nav button \{[^}]*font-size: 10px;/);
  assert.match(css, /\.mobile-bottom-nav button\[aria-current='page'\] \{ background:var\(--accent\);/);
  assert.match(css, /\.archive-dialog-reasons \[data-slot="button"\], \.archive-dialog-custom input, \.archive-dialog-custom \[data-slot="button"\] \{ min-height:44px; \}/);
  assert.match(css, /--muted-foreground: #3d518c;/);
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
  assert.match(css, /\.leads-hero \{ display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:26px; background:linear-gradient\(115deg,#fff 0%,#fff 58%,var\(--accent\) 100%\); \}/);
});

void test('Wide desktop compacts Telegram warmup without changing mobile flow', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /@media\(min-width:1181px\) \{ \.telegram-warmup-steps \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); align-items:stretch; \}/);
  assert.match(css, /\.telegram-warmup-steps \{ display:grid; gap:8px; margin:12px 0; padding:0; list-style:none; \}/);
});

void test('Empty Library uses one focused empty state instead of a redundant editor panel', () => {
  const workspace = text(join(componentsDir, 'library-workspace.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  // Empty state appears only once data is ready and nothing is visible under the current filter.
  assert.match(workspace, /const emptyWorkspace=viewReady&&!editorOpen&&visibleItems\.length===0;/);
  assert.match(workspace, /emptyWorkspace \? 'is-empty' : ''/);
  assert.match(css, /\.library-workspace\.is-empty \.library-layout \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.library-workspace\.is-empty \.library-editor \{ display:none; \}/);
});

void test('Release metadata stays synchronized and the change dialog has an opaque readable surface', () => {
  const meta = text(join(root, 'lib', 'app-meta.ts'));
  const dialog = text(join(componentsDir, 'app-release-dialog.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  const packageMeta = JSON.parse(text(join(root, 'package.json')));
  const version = meta.match(/APP_VERSION = '([^']+)'/)?.[1];
  assert.equal(version, packageMeta.version);
  assert.match(meta, /APP_RELEASE_DATE = '\d{4}-\d{2}-\d{2}'/);
  assert.match(dialog, /Intl\.DateTimeFormat\('uk-UA',[\s\S]*APP_RELEASE_DATE/);
  assert.doesNotMatch(dialog, />11 вересня 2026<\/time>/);
  assert.match(css, /\.app-release-dialog\[data-slot="dialog-content"\] \{[^}]*background: var\(--card\);[^}]*color:var\(--foreground\);[^}]*box-shadow:/);
});

void test('Primary buttons keep their foreground token instead of inheriting page text', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../components/ui/button.tsx', import.meta.url), 'utf8');
  assert.match(css, /button:not\(\[data-slot="button"\]\) \{ color: inherit; \}/);
  assert.doesNotMatch(css, /\nbutton \{ color: inherit; \}/);
  assert.match(button, /bg-primary text-primary-foreground/);
  assert.match(css, /--primary-foreground: #ffffff/);
});

void test('Dialog surfaces are opaque and lead dialogs expose readable modal chrome', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const duplicates = readFileSync(new URL('../components/chat-duplicates-dialog.tsx', import.meta.url), 'utf8');
  assert.match(css, /--color-popover: var\(--popover\)/);
  assert.match(css, /--popover: #ffffff/);
  assert.match(css, /\.lead-dialog \{[^}]*background:var\(--popover\)[^}]*box-shadow:/s);
  assert.match(duplicates, /showCloseButton=\{busy===null\}/);
});

void test('Confirmed staging layout defects stay compact at intermediate widths', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const warmup = readFileSync(new URL('../components/telegram-warmup.tsx', import.meta.url), 'utf8');
  const schedule = readFileSync(new URL('../components/telegram-schedule.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.platform-overview \{ display:grid; grid-template-columns:[^;]+; overflow:hidden;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.platform-overview \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.workday-card \{ display:grid; grid-template-columns:44px minmax\(0,1fr\)/);
  assert.match(css, /\.queue-card:has\(\.queue-empty\) \{ align-self:start; \}/);
  assert.match(warmup, /<details className="telegram-warmup"/);
  assert.match(schedule, /<details className="telegram-schedule"/);
  assert.match(css, /\.telegram-disclosure-summary/);
});

void test('Analytics trends have compact cards with separated labels and bounded charts', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.analytics-trend-grid \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\); gap:12px; \}/);
  assert.match(css, /\.analytics-trend-card > div \{[^}]*display:grid;[^}]*gap:4px/s);
  assert.match(css, /\.analytics-trend-card svg \{[^}]*height:92px/s);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.analytics-trend-grid \{ grid-template-columns:1fr; \}/);
});

void test('Past booked lessons expose explicit attendance outcomes without mutating funnel state automatically', () => {
  const followUp = readFileSync(new URL('../components/leads/follow-up.tsx', import.meta.url), 'utf8');
  const lessons = readFileSync(new URL('../components/leads/lessons.tsx', import.meta.url), 'utf8');
  assert.match(followUp, /Минулий урок ще без результату/);
  assert.match(followUp, /Зафіксуй результат, щоб воронка перейшла з «Запис» далі/);
  assert.match(lessons, /const pastBooked = l\.status === 'booked' && l\.lessonDate < today/);
  assert.match(lessons, />\s*Проведено\s*<\/Button>/);
  assert.match(lessons, />\s*Перенести\s*<\/Button>/);
  assert.match(lessons, />\s*Учень пішов\s*<\/Button>/);
  assert.match(lessons, /status: 'completed'/);
  assert.match(lessons, /status: 'no-show'/);
  assert.doesNotMatch(followUp, /mutate\('lesson_status'/);
});

void test('Dense report event sources scroll inside the disclosure instead of stretching the whole page', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.report-event-list ul \{[^}]*max-height:min\(48vh,440px\)[^}]*overflow:auto/s);
  assert.match(css, /\.report-disclosure\[open\] > summary::after \{ content:'−'; \}/);
  assert.doesNotMatch(css, /report-disclosure\[open\] > summary::after \{ content:'\?'/);
});

void test('Reports calendar does not stretch with a long editor and Settings tools stack before they squeeze', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.reports-layout \{[^}]*align-items:start/s);
  assert.match(css, /@media \(min-width:721px\) and \(max-width:1180px\)[\s\S]*\.settings-tool-row \{ grid-template-columns:38px minmax\(0,1fr\); align-items:start; \}/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.settings-tool-row \{ grid-template-columns:36px minmax\(0,1fr\);/);
});

void test('The five-step activity funnel stays one row on wide desktop without changing the four-step cohort funnel', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../components/analytics-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /className="funnel-grid is-five"[\s\S]*Приєднані чати/);
  assert.match(css, /\.funnel-grid\.is-five \{ grid-template-columns:repeat\(5,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*\.funnel-grid, \.funnel-grid\.is-five \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
});

void test('Today focus hero stops squeezing its heading at tiled desktop widths', () => {
  const css = readFileSync(new URL('../app/design-polish.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.focus-card \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?align-items: start;/);
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.focus-actions \{ width: 100%; \}/);
});

void test('Today workday card adapts before the sidebar squeezes it at laptop widths', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:1500px\)[\s\S]*\.workday-card \{ display:grid; grid-template-columns:44px minmax\(0,1fr\);/);
  assert.match(css, /@media \(max-width:1500px\)[\s\S]*\.workday-card > \.workday-actions \{ grid-column:1\/-1;/);
});

void test('Timer UI recovers from transient network failures without exposing raw browser errors', () => {
  const timers = readFileSync(new URL('../components/global-timers.tsx', import.meta.url), 'utf8');
  assert.match(timers, /response\.json\(\)\.catch\(\(\)=>\(\{\}\)\)/);
  assert.match(timers, /response\.status!==409/);
  assert.match(timers, /setTimers\(body\.timers\|\|\[\]\);\s*setError\(''\)/);
  assert.match(timers, /Таймери синхронізуються автоматично після відновлення мережі/);
  assert.match(timers, /failed to fetch\|networkerror\|load failed/);
});

void test('Library mobile toolbar gives tabs their own row and keeps search usable', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.library-toolbar \{ grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(css, /\.library-kind-picker \{ grid-column:1\/-1; min-width:0; \}/);
  assert.match(css, /\.library-search \{ grid-column:1; min-width:0; \}/);
  assert.match(css, /\.library-toolbar > \[data-slot="button"\] \{ grid-column:2; width:auto; justify-self:end; \}/);
});

void test('Long mobile Platforms and Leads lists progressively reveal items without truncating desktop', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const platforms = readFileSync(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');
  const leads = readFileSync(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');
  assert.match(platforms, /const MOBILE_LIST_CHUNK = 12/);
  assert.match(platforms, /index>=mobileVisibleChats\?'mobile-progressive-hidden'/);
  assert.match(platforms, /Показати ще чати/);
  assert.match(platforms, /mobileListState\.key===mobileListKey\?mobileListState\.count:MOBILE_LIST_CHUNK/);
  assert.match(leads, /const MOBILE_LIST_CHUNK = 12/);
  assert.match(leads, /index >= mobileVisibleLeads \? 'mobile-progressive-hidden'/);
  assert.match(leads, /Показати ще лідів/);
  assert.match(leads, /mobileListState\.key === mobileListKey \? mobileListState\.count : MOBILE_LIST_CHUNK/);
  assert.match(css, /\.mobile-list-more \{ display:none; \}/);
  assert.match(css, /@media \(max-width:1024px\)[\s\S]*\.leads-list \.mobile-progressive-hidden \{ display:none !important; \}[\s\S]*\.leads-list \.mobile-list-more \{ display:flex;/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.platform-browser \.mobile-progressive-hidden \{ display:none !important; \}[\s\S]*\.platform-browser \.mobile-list-more \{ display:flex;/);
});

void test('Selected lead heading keeps programmatic focus without the browser default outline', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const leads = readFileSync(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');
  assert.match(leads, /heading\.current\?\.focus\(\)/);
  assert.match(leads, /<h2 ref=\{heading\} tabIndex=\{-1\}>/);
  assert.match(css, /\.lead-summary h2:focus \{ outline:none; \}/);
});

void test('Leads hero uses the full responsive grid width and a full-width phone CTA', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:1200px\)[^\n]*\.leads-hero \{ display:grid; grid-template-columns:minmax\(0,1fr\); justify-content:stretch; align-items:start; \}/);
  assert.match(css, /@media\(max-width:1200px\)[^\n]*\.leads-hero > \[data-slot="button"\] \{ justify-self:start; \}/);
  assert.match(css, /@media\(max-width:720px\) \{ \.leads-hero > \[data-slot="button"\] \{ width:100%; justify-self:stretch; \} \}/);
});

void test('Mobile lead sublists stack actions and keep direct controls touch friendly', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.lead-simple-list li \{ align-items:stretch; flex-direction:column; gap:8px; \}/);
  assert.match(css, /\.lead-simple-list > li > \[data-slot="button"\] \{ width:100%; min-height:44px; \}/);
});

void test('Mobile reminder disclosure and copy action keep 44px touch targets', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.lead-reminder details > summary \{ display:flex; align-items:center; min-height:44px; \}/);
  assert.match(css, /\.lead-reminder details > \[data-slot="button"\] \{ width:100%; min-height:44px; margin-top:8px; \}/);
});

void test('Mobile lead action links keep direct touch targets without inflating inline history links', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.lead-contact-lines > a,[\s\S]*\.lead-lesson > a,[\s\S]*\.lead-actions > a \{ display:inline-flex; align-items:center; min-height:44px; \}/);
  assert.doesNotMatch(css, /\.lead-lesson a \{[^}]*min-height:44px/);
});
