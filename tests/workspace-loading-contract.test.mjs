import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

void test('main navigation keeps visited workspaces mounted instead of remounting on every transition',()=>{
  const shell=read('components/work-os-shell.tsx');
  assert.match(shell,/const \[visitedViews, setVisitedViews\] = useState<Set<ViewKey>>/);
  assert.match(shell,/setVisitedViews\(\(current\) => current\.has\(next\) \? current : new Set\(current\)\.add\(next\)\)/);
  for(const view of ['platforms','leads','analytics','reports','library','settings']){
    assert.match(shell,new RegExp(`visitedViews\\.has\\('${view}'\\).*WorkspacePane`));
  }
  assert.doesNotMatch(shell,/key=\{\`(?:leads|analytics|reports|library|settings):/);
  assert.doesNotMatch(shell,/<GlobalTimers key=/);
});

void test('server revision refreshes persistent data workspaces without remount keys',()=>{
  const shell=read('components/work-os-shell.tsx');
  assert.match(shell,/LeadsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'leads'\}/);
  assert.match(shell,/AnalyticsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'analytics'\}/);
  assert.match(shell,/ReportsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'reports'\}/);
  assert.match(shell,/LibraryWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'library'\}/);
  for(const file of ['components/leads/workspace.tsx','components/analytics-workspace.tsx','components/reports-workspace.tsx','components/library-workspace.tsx']){
    const source=read(file);
    assert.match(source,/lastSyncRevision/);
    assert.match(source,/if \(!?active|if\(!active/);
  }
});

void test('core screens use one stable loading language and never clear usable data to show a spinner',()=>{
  const loadState=read('components/workspace-load-state.tsx');
  assert.match(loadState,/WorkspaceInitialLoading/);
  assert.match(loadState,/WorkspaceRefreshIndicator/);
  assert.match(loadState,/setTimeout\(\(\)=>setVisible\(true\),delay\)/);

  const core=[
    'components/platform-workspace.tsx',
    'components/leads/workspace.tsx',
    'components/analytics-workspace.tsx',
    'components/reports-workspace.tsx',
    'components/library-workspace.tsx',
  ];
  for(const file of core){
    const source=read(file);
    assert.match(source,/WorkspaceInitialLoading/);
    assert.doesNotMatch(source,/className="workspace-loading"/);
    assert.doesNotMatch(source,/setData\(null\)/);
  }
});

void test('known transition hot spots retain data while revalidating',()=>{
  const library=read('components/library-workspace.tsx');
  assert.match(library,/viewCache=useRef\(new Map<string,Item\[]>\(\)\)/);
  assert.match(library,/refreshing&&hasLoaded\.current/);
  assert.match(library,/void load\(true\)/);

  const reports=read('components/reports-workspace.tsx');
  assert.match(reports,/dataCache = useRef\(new Map<string,ReportData>\(\)\)/);
  assert.doesNotMatch(reports,/setData\(null\)/);
  assert.match(reports,/selected&&editorData/);

  const leads=read('components/leads/workspace.tsx');
  assert.match(leads,/detailCache = useRef\(new Map<string,LeadDetail>\(\)\)/);
  assert.doesNotMatch(leads,/setDetail\(null\)/);

  const analytics=read('components/analytics-workspace.tsx');
  assert.match(analytics,/loading && !data \? <WorkspaceInitialLoading/);
});

void test('persistent settings re-syncs server props instead of depending on a remount',()=>{
  const settings=read('components/settings-workspace.tsx');
  assert.match(settings,/useEffect\(\(\)=>\{if\(!savingPlatforms\)setEnabledPlatforms\(snapshot\.enabledPlatforms\);\}/);
});
