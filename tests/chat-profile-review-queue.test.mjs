import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

void test('CHAT-22 has a dedicated profile-review queue backed by waiting and ready chats', () => {
  const route = source('app/api/chats/route.ts');
  const platform = source('components/platform-workspace.tsx');

  assert.match(route, /'profile_review'/);
  assert.match(route, /c\.workflow_status IN \('waiting','ready'\)/);
  assert.match(route, /status === 'profile_review' \|\| profile === 'needs_review'/);
  assert.match(route, /counts\.profile_review=profileCounts\.profile_review\.needsReview/);

  assert.match(platform, /type Queue = WorkflowQueue \| 'profile_review'/);
  assert.match(platform, /\{key:'profile_review',label:'Уточнити профіль'\}/);
  assert.match(platform, /queue==='profile_review'&&<Badge variant="secondary">\{chat\.status==='waiting'\?'Очікування':'Для публікації'\}<\/Badge>/);
  assert.match(platform, /queue==='profile_review'\?'Уточнити профіль':'Профіль'/);
  assert.match(platform, /queue==='profile_review'\?'Усі профілі уточнено':'У цій черзі нічого немає'/);
});

void test('profile-review queue stays focused and responsive', () => {
  const platform = source('components/platform-workspace.tsx');
  const css = source('app/globals.css');

  assert.match(platform, /queue!=='profile_review'&&<select/);
  assert.match(platform, /queue==='ready'&&\(platform==='whatsapp'\|\|platform==='viber'\)/);
  assert.match(css, /\.queue-tabs \{ display:grid; grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /@container platform-browser \(max-width: 820px\)[\s\S]*\.queue-tabs \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.queue-tabs \{ display:flex; overflow-x:auto/);
  assert.match(css, /\.queue-tabs button \{ flex:0 0 auto; min-width:132px; min-height:48px/);
});
