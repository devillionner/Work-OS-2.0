import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

void test('main navigation keeps visited workspaces mounted instead of remounting on every transition',()=>{
  const shell=read('components/work-os-shell.tsx');
  assert.match(shell,/const \[visitedViews, setVisitedViews\] = useState<Set<ViewKey>>/);
  assert.match(shell,/setVisitedViews\(\(current\) => current\.has\(next\) \? current : new Set\(current\)\.add\(next\)\)/);
  for(const view of ['platforms','leads','analytics','reports','library','settings']){
    assert.match(shell,new RegExp(`visitedViews\\.has\\('${view}'\\).*WorkspacePane`));
  }
  assert.doesNotMatch(shell,/key=\{`(?:leads|analytics|reports|library|settings):/);
  assert.doesNotMatch(shell,/<GlobalTimers key=/);
});

void test('server revision refreshes persistent data workspaces without remount keys',()=>{
  const shell=read('components/work-os-shell.tsx');
  assert.match(shell,/LeadsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'leads'\}/);
  assert.match(shell,/AnalyticsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'analytics'\}/);
  assert.match(shell,/ReportsWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'reports'\}/);
  assert.match(shell,/LibraryWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'library'\}/);
  assert.match(shell,/PlatformWorkspace[^>]+syncRevision=\{syncRevision\}[^>]+active=\{activeView === 'platforms'\}/);
  assert.match(shell,/SettingsWorkspace[^>]+active=\{activeView === 'settings'\}/);
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
  assert.match(library,/const \[loadedKey,setLoadedKey\]=useState\(''\)/);
  assert.match(library,/const viewReady=loadedKey===currentViewKey\|\|cachedView!==undefined/);
  assert.match(library,/request===loadSeq\.current/);
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
  assert.match(settings,/lastSnapshotPlatformsKey=useRef\(snapshotPlatformsKey\)/);
  assert.match(settings,/setEnabledPlatforms\(snapshot\.enabledPlatforms\)/);
});

void test('persistent hidden workspaces close portal overlays and disable hidden global shortcuts',()=>{
  const platform=read('components/platform-workspace.tsx');
  for(const setter of ['setBulkOpen(false)','setDiscoveryOpen(false)','setDuplicatesOpen(false)','setProfileChat(null)','setHistoryChat(null)','setPublishChat(null)','setConfirmation(null)','setArchiveId(null)','setDeleteChat(null)']) {
    assert.match(platform,new RegExp(setter.replace(/[()]/g,'\\$&')));
  }

  const leads=read('components/leads/workspace.tsx');
  assert.match(leads,/if \(active\) return;[\s\S]*setHistoryOpen\(false\)[\s\S]*setEditor\(null\)[\s\S]*setArchive\(false\)[\s\S]*setResponseChange\(false\)/);
  assert.match(leads,/if\(!active\)return;[\s\S]*document\.addEventListener\('keydown'/);
  assert.match(leads,/\{active&&<>[\s\S]*<FollowUp[\s\S]*<Lessons[\s\S]*<Conversation/);

  const analytics=read('components/analytics-workspace.tsx');
  assert.match(analytics,/if \(!active\) setDetailMetric\(null\)/);

  const reports=read('components/reports-workspace.tsx');
  assert.match(reports,/if \(!active\) \{[\s\S]*setHistoryOpen\(false\)[\s\S]*setBackdatedLeadOpen\(false\)/);
  assert.match(reports,/if\(!active\)return;[\s\S]*window\.addEventListener\('keydown'/);
  assert.match(reports,/\{active&&<ReportCheckpoints date=\{selected\} \/>\}/);

  const library=read('components/library-workspace.tsx');
  assert.match(library,/if\(active\)return;[\s\S]*setHistoryOpen\(false\)[\s\S]*setArchiveCandidate\(null\)/);

  const settings=read('components/settings-workspace.tsx');
  for(const setter of ['setFocusOpen(false)','setGoalHistoryOpen(false)','setUpdatePreviewOpen(false)','setRestoreOpen(false)','setDuplicatesOpen(false)','setCsvOpen(false)','setNamesOpen(false)']) {
    assert.match(settings,new RegExp(setter.replace(/[()]/g,'\\$&')));
  }
});

void test('nested loading surfaces use the shared inline state and do not replace existing data during refresh',()=>{
  const shared=read('components/workspace-load-state.tsx');
  assert.match(shared,/export function WorkspaceInlineLoading/);

  for(const file of [
    'components/telegram-schedule.tsx',
    'components/leads/today-activity.tsx',
    'components/report-subject-analytics.tsx',
    'components/report-manual-diff.tsx',
    'components/report-checkpoints.tsx',
    'components/report-publication-correction.tsx',
    'components/report-lesson-result-correction.tsx',
  ]){
    const source=read(file);
    assert.match(source,/WorkspaceInlineLoading/);
    assert.doesNotMatch(source,/className="workspace-loading"/);
  }

  const manual=read('components/report-manual-diff.tsx');
  assert.match(manual,/loading && !data \? <WorkspaceInlineLoading/);
  const checkpoints=read('components/report-checkpoints.tsx');
  assert.match(checkpoints,/cache=useRef\(new Map<string,Checkpoint\[]>\(\)\)/);
  assert.match(checkpoints,/loading&&loadedDate!==date \? <WorkspaceInlineLoading/);
});


void test('no component may bring back the legacy blocking workspace loader',()=>{
  const root=fileURLToPath(new URL('../components',import.meta.url));
  const files=[];
  const walk=(dir)=>{
    for(const name of readdirSync(dir)){
      const path=join(dir,name);
      if(statSync(path).isDirectory())walk(path);
      else if(name.endsWith('.tsx'))files.push(path);
    }
  };
  walk(root);
  for(const path of files){
    if(path.endsWith('workspace-load-state.tsx'))continue;
    const source=readFileSync(path,'utf8');
    assert.doesNotMatch(source,/className=["']workspace-loading["']/,path);
  }
});

void test('history and preparation dialogs retain cache instead of remounting into loaders',()=>{
  const platform=read('components/platform-workspace.tsx');
  assert.doesNotMatch(platform,/historyOpenKey|publishOpenKey/);
  assert.doesNotMatch(platform,/<ChatHistoryDialog key=/);
  assert.doesNotMatch(platform,/<ChatPublishDialog key=/);

  for(const file of [
    'components/chat-history-dialog.tsx',
    'components/analytics-metric-dialog.tsx',
    'components/library-history-dialog.tsx',
    'components/report-history-dialog.tsx',
    'components/leads/history.tsx',
    'components/leads/lesson-history.tsx',
  ]){
    const source=read(file);
    assert.match(source,/WorkspaceInlineLoading/);
    assert.match(source,/useRef\(new Map</);
  }

  const publish=read('components/chat-publish-dialog.tsx');
  assert.match(publish,/selectionCache=useRef\(new Map<string,SelectionPayload>\(\)\)/);
  assert.match(publish,/WorkspaceInlineLoading/);
});

void test('Library never renders a previous collection under a new view identity',()=>{
  const library=read('components/library-workspace.tsx');
  assert.match(library,/const currentViewKey=libraryViewKey\(collection,archived,search\)/);
  assert.match(library,/const viewItems=loadedKey===currentViewKey\?items:\(cachedView\|\|\[\]\)/);
  assert.match(library,/if\(cached\)\{setItems\(cached\);setLoadedKey\(key\);\} else setLoadedKey\(''\)/);
  assert.match(library,/!viewReady\?<WorkspaceInitialLoading/);
});


void test('dialog and CRM state sync uses props instead of remount keys',()=>{
  const platform=read('components/platform-workspace.tsx');
  assert.doesNotMatch(platform,/profileOpenKey|historyOpenKey|publishOpenKey/);
  assert.doesNotMatch(platform,/<ChatProfileDialog key=|<ChatHistoryDialog key=|<ChatPublishDialog key=/);

  const profile=read('components/chat-profile-dialog.tsx');
  assert.doesNotMatch(profile,/return <ChatProfileDialogForm key=/);
  assert.match(profile,/useEffect\(\(\)=>\{[\s\S]*setName\(chat\.name\)[\s\S]*setReviewStatus/);

  const leads=read('components/leads/workspace.tsx');
  assert.doesNotMatch(leads,/<Conversation key=\{current\.lead\.version\}/);

  const conversation=read('components/leads/conversation.tsx');
  assert.match(conversation,/const leadIdentity = useRef\(detail\.lead\.id\)/);
  assert.match(conversation,/mediaVersion\.current=detail\.lead\.version/);
  assert.match(conversation,/if\(leadIdentity\.current===detail\.lead\.id\)return/);
});


void test('cached dialogs never reveal a previous view after a new-view request fails',()=>{
  const duplicates=read('components/chat-duplicates-dialog.tsx');
  assert.match(duplicates,/const viewReady=Boolean\(currentKey\)&&loadedKey===currentKey/);
  assert.match(duplicates,/viewReady&&groups\.length/);

  const libraryHistory=read('components/library-history-dialog.tsx');
  assert.match(libraryHistory,/const viewReady=Boolean\(item\)&&loadedId===item\.id/);
  assert.match(libraryHistory,/viewReady&&versions\.length/);

  const reportHistory=read('components/report-history-dialog.tsx');
  assert.match(reportHistory,/const viewReady=Boolean\(date\)&&loadedDate===date/);
  assert.match(reportHistory,/viewReady&&events\.length/);

  const leadHistory=read('components/leads/history.tsx');
  assert.match(leadHistory,/const viewReady=Boolean\(lead\)&&loadedId===lead\.id/);
  assert.match(leadHistory,/viewReady&&events\.length/);

  const lessonHistory=read('components/leads/lesson-history.tsx');
  assert.match(lessonHistory,/const viewReady=Boolean\(lesson\)&&loadedId===lesson\.id/);
  assert.match(lessonHistory,/viewReady&&events\.length/);
});
