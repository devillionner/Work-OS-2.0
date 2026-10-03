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
  assert.match(workspace,/announceDataChange\('platforms'\)/);
  assert.match(workspace,/void reloadChats\.current\(true\)/);
});


void test('ambiguous publication network failures force canonical reconciliation before retry', () => {
  const workspace=read('components/platform-workspace.tsx');
  assert.match(workspace,/const publicationAction=action==='published'\|\|action==='undo_published'/);
  assert.match(workspace,/await reloadChats\.current\(true\)/);
  assert.match(workspace,/timeout cannot[\s\S]*duplicate manual action/);
  assert.match(workspace,/result=\{ok:false,error,refresh:publicationAction\}/);
});


void test('WhatsApp ready rows expose cancellable autopost jobs and disable conflicting manual publication', () => {
  const workspace=read('components/platform-workspace.tsx');
  const route=read('app/api/chats/route.ts');
  assert.match(workspace,/action:'whatsapp-autopost'/);
  assert.match(workspace,/cancel-whatsapp-autopost/);
  assert.match(workspace,/Автопост у черзі/);
  assert.match(workspace,/Скасувати автопост/);
  assert.match(workspace,/Boolean\(chat\.autopostJobId\)/);
  assert.match(route,/whatsapp_autopost_jobs/);
  assert.match(route,/autopostJobId/);
});


void test('active WhatsApp autopost is a server-side chat mutation fence, not only a disabled button', () => {
  const route=read('app/api/chats/route.ts');
  assert.match(route,/status IN \('pending','claimed'\)/);
  assert.match(route,/виконується WhatsApp автопублікація/);
});


void test('WhatsApp ready queue can create a reservation-aware autopost batch from one operator action', () => {
  const workspace=read('components/platform-workspace.tsx');
  const automationRoute=read('app/api/messenger-automation/route.ts');
  const selection=read('lib/chats/advertisement-selection.ts');
  assert.match(workspace,/startWhatsAppAutopostBatch/);
  assert.match(workspace,/whatsapp-autopost-batch/);
  assert.match(workspace,/Автопост черги/);
  assert.match(workspace,/limit:30/);
  assert.match(automationRoute,/createWhatsAppAutopostBatch/);
  assert.match(automationRoute,/body\.action==='whatsapp-autopost-batch'/);
  assert.match(selection,/whatsapp_autopost_jobs/);
  assert.match(selection,/excludeAutomationJobId/);
});

void test('WhatsApp waiting queue explains the operator-started request check',()=>{
  const workspace=read('components/platform-workspace.tsx');
  const panel=read('components/whatsapp-waiting-check-panel.tsx');
  assert.match(workspace,/queue==='waiting'&&platform==='whatsapp'&&<WhatsappWaitingCheckPanel/);
  assert.match(workspace,/onAction=\{action=>void changeWaitingCheck\(action\)\}/);
  assert.match(panel,/Перевірка заявок WhatsApp/);
  assert.match(panel,/Перевірити зараз/);
  assert.match(panel,/onAction\('stop'\)/);
  assert.match(panel,/onAction\('retry_problems'\)/);
  assert.match(panel,/заявки без відповіді відкладаються на 3 дні/);
  assert.match(panel,/waitingCheckRunnerState\(view, nowSeconds\)/);
  // Every undecided problem can be resolved with buttons right in the panel.
  for (const action of ['open','approved','snooze','archive']) assert.match(panel,new RegExp(`onProblemAction\\(item, '${action}'\\)`));
  assert.match(workspace,/onProblemAction=\{\(problem,action\)=>void resolveWaitingProblem\(problem,action\)\}/);
  assert.match(workspace,/reason:waitingCheckArchiveReason\(problem\.reason\)/);
});
