import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('published and undo return an authoritative platform publication snapshot', () => {
  const route=read('app/api/chats/route.ts');
  assert.match(route,/publicationState = await readPublicationState/);
  assert.match(route,/chatPublishedToday/);
  assert.match(route,/publishedToday:publishedResult\.results/);
  assert.match(route,/availableToday:availableResult\.results/);
  assert.match(route,/cancelled_at IS NULL/);
  assert.match(route,/resolveDailyPublicationGoal\(goalValue,date\)/);
});

void test('platform workspace reconciles confirmed publication state immediately then refreshes in background', () => {
  const workspace=read('components/platform-workspace.tsx');
  assert.match(workspace,/publicationState\?:PublicationState/);
  assert.match(workspace,/setData\(current=>/);
  assert.match(workspace,/publishedToday:publicationState\.publishedToday/);
  assert.match(workspace,/availableToday:publicationState\.availableToday/);
  assert.match(workspace,/publicationPace:publicationState\.publicationPace/);
  assert.match(workspace,/announceDataChange\('all'\)/);
  assert.match(workspace,/void reloadChats\.current\(true\)/);
});


void test('ambiguous publication network failures force canonical reconciliation before retry', () => {
  const workspace=read('components/platform-workspace.tsx');
  assert.match(workspace,/const publicationAction=action==='published'\|\|action==='undo_published'/);
  assert.match(workspace,/await reloadChats\.current\(true\)/);
  assert.match(workspace,/timeout cannot[\s\S]*duplicate manual action/);
  assert.match(workspace,/result=\{ok:false,error,refresh:publicationAction\}/);
});
