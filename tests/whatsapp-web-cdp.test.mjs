import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyWhatsAppSnapshot,
  deriveWhatsappQualification,
  leaveWhatsappTaskViaCdp,
  readWorkOsExecutorTokenViaCdp,
  sendWhatsappAutopostViaCdp,
  isLocalCdpWebSocketUrl,
  normalizeLocalCdpBaseUrl,
  normalizeTargetLabel,
  toWhatsAppWebInviteUrl,
  whatsappInviteCode,
} from '../scripts/whatsapp-web-cdp.mjs';

const source=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');

const task = {
  runtime: 'whatsapp_web',
  platform: 'whatsapp',
  action: 'join_and_inspect',
  name: 'Українці Варшава',
  expectedTarget: {
    name: 'Українці Варшава',
    link: 'https://chat.whatsapp.com/AbCdEfGh1234',
  },
};

void test('Work OS local preflight bridge finds the active tab when duplicate Work OS tabs are open', () => {
  assert.match(source,/listWorkOsPagesForCdp/);
  assert.match(source,/for\(const page of pagesResult\.pages\)/);
  assert.match(source,/if\(value\.active===true\|\|value\.task\)/);
  assert.match(source,/work_os_result_target_not_found/);
});

void test('WhatsApp invite conversion keeps only the exact invite code', () => {
  assert.equal(whatsappInviteCode(task.expectedTarget.link), 'AbCdEfGh1234');
  assert.equal(
    toWhatsAppWebInviteUrl(task.expectedTarget.link),
    'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
  );
  assert.equal(whatsappInviteCode('https://example.com/AbCdEfGh1234'), null);
});

void test('target matching is normalized but fail-closed for the wrong chat', () => {
  assert.equal(normalizeTargetLabel('  УКРАЇНЦІ   Варшава '), 'українці варшава');
  const result = classifyWhatsAppSnapshot(task, {
    targetTexts: ['Українці Краків'],
    headerTitles: [],
    buttons: ['Join group'],
    bodyText: 'Join group',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'target_not_verified' });
});

void test('join is allowed only after exact target verification', () => {
  const result = classifyWhatsAppSnapshot(task, {
    targetTexts: ['Українці Варшава'],
    headerTitles: [],
    buttons: ['Join group'],
    bodyText: 'Join group',
  });
  assert.deepEqual(result, {
    kind: 'action',
    action: 'join',
    buttonText: 'Join group',
    observedName: 'Українці Варшава',
  });
});

void test('approval-required invite is skipped without sending a join request', () => {
  for(const label of ['Request to join','Подати запит на вступ','Надіслати запит на вступ']){
    const result = classifyWhatsAppSnapshot(task, {
      url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
      navigatedInviteCode:'AbCdEfGh1234',
      targetTexts:['Українці Варшава'],
      headerTitles:[],
      buttons:[label],
      bodyText:label,
    });
    assert.equal(result.kind,'result',label);
    assert.equal(result.result.reason,'approval_required',label);
    assert.equal(result.result.membershipState,'not_checked',label);
    assert.equal(result.result.targetVerified,true,label);
  }
});

void test('approval hint blocks a generic join button before it can send a request', () => {
  const result = classifyWhatsAppSnapshot(task, {
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    navigatedInviteCode:'AbCdEfGh1234',
    targetTexts:['Українці Варшава'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Admin approval is required before you can join this group. Join group',
  });
  assert.equal(result.kind,'result');
  assert.equal(result.result.reason,'approval_required');
  assert.equal(result.result.membershipState,'not_checked');
});

void test('join preflight may safely open a verified view/continue control before the join step', () => {
  const result=classifyWhatsAppSnapshot(task,{
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    navigatedInviteCode:'AbCdEfGh1234',
    targetTexts:['Українці Варшава'],
    headerTitles:[],
    buttons:['Continue to Chat'],
    bodyText:'Continue to Chat',
  });
  assert.deepEqual(result,{
    kind:'action',action:'view',buttonText:'Continue to Chat',observedName:'Українці Варшава',
  });
});

void test('pending membership is reported only for the verified target', () => {
  const result = classifyWhatsAppSnapshot(
    { ...task, action: 'check_membership_and_inspect' },
    {
      targetTexts: ['Українці Варшава'],
      headerTitles: [],
      buttons: [],
      bodyText: 'Request to join sent',
    },
  );
  assert.equal(result.kind, 'result');
  assert.equal(result.result.targetVerified, true);
  assert.equal(result.result.membershipState, 'pending');
  assert.equal(result.result.accessible, true);
});

void test('post-invite joined chat verifies the navigated target after WhatsApp drops the invite URL', () => {
  const generatedTask = {
    ...task,
    name: 'WhatsApp · AbCdEfGh1234',
    expectedTarget: {
      ...task.expectedTarget,
      name: 'WhatsApp · AbCdEfGh1234',
    },
  };
  const result = classifyWhatsAppSnapshot(generatedTask, {
    url:'https://web.whatsapp.com/',
    navigatedInviteCode:'AbCdEfGh1234',
    targetHeadings:[],
    targetTexts:[],
    headerNames:['Technical Support'],
    headerTitles:['Деталі профілю', '+967 775 052 664, +962 7 9558 5434'],
    buttons:[],
    bodyText:'Ви приєдналися за запрошенням\n18 учасників\nЛише адміністратори можуть надсилати повідомлення',
    mainText:'Ви приєдналися за запрошенням',
    composer:false,
    adminOnly:true,
  });
  assert.equal(result.kind, 'result');
  assert.equal(result.result.targetVerified, true);
  assert.equal(result.result.membershipState, 'joined');
  assert.equal(result.result.observedName, 'Technical Support');
  assert.equal(result.result.canWrite, false);
});

void test('current WhatsApp DOM reads semantic conversation names before helper title attributes', async () => {
  const source = await import('node:fs/promises').then(({readFile}) =>
    readFile(new URL('../scripts/whatsapp-web-cdp.mjs', import.meta.url), 'utf8')
  );
  assert.match(source, /#main header \[dir="auto"\]/);
  assert.match(source, /headerNames/);
  assert.match(source, /node\.getAttribute\('aria-label'\)/);
  assert.match(source, /labelOf = \(item\) => item\.getAttribute\('aria-label'\)/);
  assert.match(source, /li-delete-group|leavePattern/);
});

void test('joined exact chat reports writeability without inventing qualification facts', () => {
  const result = classifyWhatsAppSnapshot(
    { ...task, action: 'inspect' },
    {
      targetTexts: [],
      headerTitles: ['Українці Варшава'],
      buttons: [],
      bodyText: '',
      composer: true,
      adminOnly: false,
    },
  );
  assert.equal(result.kind, 'result');
  assert.equal(result.result.membershipState, 'joined');
  assert.equal(result.result.canWrite, true);
  assert.equal('adsPolicy' in result.result, false);
  assert.equal('activityState' in result.result, false);
  assert.equal(result.result.topicMatch, 'match');
});

void test('known invalid invite can be reported inaccessible without claiming target verification', () => {
  const result = classifyWhatsAppSnapshot(task, {
    targetTexts: [],
    headerTitles: [],
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    buttons: [],
    bodyText: 'This invite link is invalid or was reset',
  });
  assert.equal(result.kind, 'result');
  assert.deepEqual(result.result, {
    status: 'failed',
    accessible: false,
    targetVerified: false,
    reason: 'invalid_whatsapp_link',
  });
});

void test('generated or approximate names require exact invite-code context before WhatsApp action', () => {
  const generatedTask = {
    ...task,
    name: 'WhatsApp · AbCdEfGh',
    expectedTarget: {
      ...task.expectedTarget,
      name: 'WhatsApp · AbCdEfGh',
    },
  };
  const outsideInvite = classifyWhatsAppSnapshot(generatedTask, {
    url:'https://web.whatsapp.com/',
    targetHeadings:['Справжня назва групи'],
    targetTexts:['Справжня назва групи'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Join group',
  });
  assert.deepEqual(outsideInvite, { kind:'blocked', reason:'target_not_verified' });

  const exactInvite = classifyWhatsAppSnapshot(generatedTask, {
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    targetHeadings:['Справжня назва групи'],
    targetTexts:['Справжня назва групи'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Join group',
  });
  assert.deepEqual(exactInvite, {
    kind:'action',
    action:'join',
    buttonText:'Join group',
    observedName:'Справжня назва групи',
  });
});


void test('HTML or URL source noise uses exact invite context instead of trusting the broken name', () => {
  const noisyTask = {
    ...task,
    name: 'om <img src="',
    expectedTarget: {
      ...task.expectedTarget,
      name: 'om <img src="',
    },
  };
  const outsideInvite = classifyWhatsAppSnapshot(noisyTask, {
    url:'https://web.whatsapp.com/',
    targetHeadings:['Українці Берлін'],
    targetTexts:['Українці Берлін'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Join group',
  });
  assert.deepEqual(outsideInvite, { kind:'blocked', reason:'target_not_verified' });

  const exactInvite = classifyWhatsAppSnapshot(noisyTask, {
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    targetHeadings:['Українці Берлін'],
    targetTexts:['Українці Берлін'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Join group',
  });
  assert.deepEqual(exactInvite, {
    kind:'action',
    action:'join',
    buttonText:'Join group',
    observedName:'Українці Берлін',
  });
});

void test('verified invite navigation survives WhatsApp SPA URL rewrite for community join', () => {
  const noisyTask = {
    ...task,
    name: 'om <img src="',
    expectedTarget: {
      ...task.expectedTarget,
      name: 'om <img src="',
    },
  };
  const rewritten = classifyWhatsAppSnapshot(noisyTask, {
    url:'https://web.whatsapp.com/',
    navigatedInviteCode:'AbCdEfGh1234',
    targetHeadings:['UGC NET JRF DECEMBER 2025 GROUP'],
    targetTexts:['UGC NET JRF DECEMBER 2025 GROUP'],
    headerTitles:[],
    buttons:['Приєднатися до спільноти'],
    bodyText:'Приєднатися до спільноти',
  });
  assert.deepEqual(rewritten, {
    kind:'action',
    action:'join',
    buttonText:'Приєднатися до спільноти',
    observedName:'UGC NET JRF DECEMBER 2025 GROUP',
  });

  const wrongNavigation = classifyWhatsAppSnapshot(noisyTask, {
    url:'https://web.whatsapp.com/',
    navigatedInviteCode:'DifferentCode999',
    targetHeadings:['UGC NET JRF DECEMBER 2025 GROUP'],
    targetTexts:['UGC NET JRF DECEMBER 2025 GROUP'],
    headerTitles:[],
    buttons:['Приєднатися до спільноти'],
    bodyText:'Приєднатися до спільноти',
  });
  assert.deepEqual(wrongNavigation, { kind:'blocked', reason:'target_not_verified' });
});

void test('join retry-later modal is factual but does not mark the invite unavailable', () => {
  const result = classifyWhatsAppSnapshot(task, {
    url:'https://web.whatsapp.com/',
    navigatedInviteCode:'AbCdEfGh1234',
    targetHeadings:[],
    targetTexts:[],
    headerTitles:[],
    buttons:['Скасувати'],
    bodyText:'Не вдалося приєднатися до цієї групи. Повторіть спробу пізніше.',
  });
  assert.deepEqual(result, {
    kind:'result',
    result:{status:'failed',targetVerified:true,reason:'whatsapp_join_retry_later'},
  });
});

void test('known unavailable text is ignored outside the exact invite context', () => {
  const result = classifyWhatsAppSnapshot(task, {
    url: 'https://web.whatsapp.com/',
    targetTexts: [],
    headerTitles: [],
    buttons: [],
    bodyText: 'This invite link is invalid or was reset',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'target_not_verified' });
});

void test('known unavailable text is accepted only while the expected invite code is active', () => {
  const result = classifyWhatsAppSnapshot(task, {
    url: 'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    targetTexts: [],
    headerTitles: [],
    buttons: [],
    bodyText: 'This invite link is invalid or was reset',
  });
  assert.equal(result.kind, 'result');
  assert.equal(result.result.reason, 'invalid_whatsapp_link');
  assert.equal(result.result.targetVerified, false);
});

void test('verified pending target may use the WhatsApp Continue to Chat control', () => {
  const result = classifyWhatsAppSnapshot(
    { ...task, action: 'check_membership_and_inspect' },
    {
      targetTexts: ['Українці Варшава'],
      headerTitles: [],
      buttons: ['Continue to Chat'],
      bodyText: '',
    },
  );
  assert.deepEqual(result, {
    kind: 'action',
    action: 'view',
    buttonText: 'Continue to Chat',
    observedName: 'Українці Варшава',
  });
});


void test('CDP control is restricted to unauthenticated loopback endpoints', () => {
  assert.equal(normalizeLocalCdpBaseUrl('http://127.0.0.1:9222/'), 'http://127.0.0.1:9222');
  assert.equal(normalizeLocalCdpBaseUrl('http://localhost:9222'), 'http://localhost:9222');
  assert.equal(normalizeLocalCdpBaseUrl('http://[::1]:9222'), 'http://[::1]:9222');
  assert.equal(normalizeLocalCdpBaseUrl('https://127.0.0.1:9222'), null);
  assert.equal(normalizeLocalCdpBaseUrl('http://user:pass@127.0.0.1:9222'), null);
  assert.equal(normalizeLocalCdpBaseUrl('http://192.168.1.50:9222'), null);
  assert.equal(normalizeLocalCdpBaseUrl('https://debug.example.test'), null);

  assert.equal(isLocalCdpWebSocketUrl('ws://127.0.0.1:9222/devtools/page/1'), true);
  assert.equal(isLocalCdpWebSocketUrl('ws://localhost:9222/devtools/page/1'), true);
  assert.equal(isLocalCdpWebSocketUrl('wss://127.0.0.1:9222/devtools/page/1'), false);
  assert.equal(isLocalCdpWebSocketUrl('ws://10.0.0.2:9222/devtools/page/1'), false);
});


void test('leave confirmation accepts current localized full group-exit labels but remains exact', async () => {
  const source = await import('node:fs/promises').then(({readFile}) =>
    readFile(new URL('../scripts/whatsapp-web-cdp.mjs', import.meta.url), 'utf8')
  );
  assert.match(source, /вийти\(\?: з групи\)\?/);
  assert.match(source, /data-animate-modal-popup/);
});

void test('leave automation helper is exported for verified WhatsApp executor leave tasks', () => {
  assert.equal(typeof leaveWhatsappTaskViaCdp, 'function');
});


void test('joined qualification extracts factual member, recent activity and explicit ads evidence', () => {
  const facts = deriveWhatsappQualification({
    groupInfoText:'Українська спільнота · 1 234 participants · Advertising allowed',
    mainText:'Today 12:10 Hello',
    messageTexts:['Привіт усім','Шукаю квартиру'],
    messageMeta:[],
    headerTitles:['Українці Варшава'],
  });
  assert.equal(facts.memberCount,1234);
  assert.equal(facts.activityState,'active');
  assert.equal(facts.adsPolicy,'allowed');
  assert.equal(facts.topicMatch,'match');
});

void test('joined qualification parses compact factual member counts used by localized WhatsApp UI', () => {
  for (const [label, expected] of [
    ['Ukrainians Berlin · 1.2K members',1200],
    ['Українці Berlin · 1,2K participants',1200],
    ['Українці Berlin · 1,2 тис. учасників',1200],
    ['Українці Berlin · 1.2 тыс. участников',1200],
    ['Українці Berlin · 999 members',999],
    ['Українці Berlin · 1,234 members',1234],
  ]) {
    const facts=deriveWhatsappQualification({
      groupInfoText:label,
      mainText:'',
      messageTexts:[],
      messageMeta:[],
      headerTitles:['Українці Berlin'],
    });
    assert.equal(facts.memberCount,expected,label);
  }
});

void test('member count stays unknown when a compact number has no factual participant label', () => {
  const facts=deriveWhatsappQualification({
    groupInfoText:'Українці Berlin · 1.2K views',
    mainText:'',
    messageTexts:[],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(facts.memberCount,undefined);
});

void test('recent repeated advertisement evidence may satisfy inferred ads policy without inventing explicit permission', () => {
  const facts = deriveWhatsappQualification({
    groupInfoText:'1,250 participants',
    mainText:'Today',
    messageTexts:['Продам дитяче крісло','Послуги репетитора англійської','Звичайне повідомлення'],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(facts.memberCount,1250);
  assert.equal(facts.activityState,'active');
  assert.equal(facts.adsPolicy,'inferred_allowed');
});

void test('runtime topic match needs factual Ukrainian identity and never comes from a generic group name', () => {
  const ukrainian = deriveWhatsappQualification({
    groupInfoText:'1 120 participants',
    mainText:'Today',
    messageTexts:['Звичайне повідомлення'],
    messageMeta:[],
    headerTitles:['Ukrainians in Berlin'],
  });
  assert.equal(ukrainian.topicMatch,'match');

  const generic = deriveWhatsappQualification({
    groupInfoText:'1 120 participants',
    mainText:'Today',
    messageTexts:['Hello parents'],
    messageMeta:[],
    headerTitles:['Berlin Parents Community'],
  });
  assert.equal(generic.topicMatch,undefined);
});

void test('runtime spam mismatch has priority over an otherwise positive Ukrainian identity', () => {
  const facts = deriveWhatsappQualification({
    groupInfoText:'Українці Berlin crypto signals · 1 400 participants',
    mainText:'Today',
    messageTexts:['Привіт'],
    messageMeta:[],
    headerTitles:['Українці Berlin crypto signals'],
  });
  assert.equal(facts.topicMatch,'mismatch');
});

void test('recent repeated marketplace/service evidence supports inferred ads policy across UA/RU/EN wording', () => {
  for (const messages of [
    ['Віддам дитячі речі','Обмін велосипеда на самокат'],
    ['Продаю стіл','Ищу репетитора английского'],
    ['Looking for apartment','Services: math tutor'],
  ]) {
    const facts=deriveWhatsappQualification({
      groupInfoText:'Українці Berlin · 1 200 participants',
      mainText:'Today',
      messageTexts:messages,
      messageMeta:[],
      headerTitles:['Українці Berlin'],
    });
    assert.equal(facts.activityState,'active');
    assert.equal(facts.adsPolicy,'inferred_allowed');
  }
});

void test('ads inference remains fail-closed with one ad-like message, inactive evidence or explicit prohibition', () => {
  const one=deriveWhatsappQualification({
    groupInfoText:'Українці Berlin · 1 200 participants',
    mainText:'Today',
    messageTexts:['Продаю стіл','Звичайне повідомлення'],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(one.adsPolicy,undefined);

  const inactive=deriveWhatsappQualification({
    groupInfoText:'Українці Berlin · 1 200 participants',
    mainText:'',
    messageTexts:['Продаю стіл','Шукаю квартиру'],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(inactive.activityState,undefined);
  assert.equal(inactive.adsPolicy,undefined);

  const forbidden=deriveWhatsappQualification({
    groupInfoText:'Українці Berlin · 1 200 participants · Реклама заборонена',
    mainText:'Today',
    messageTexts:['Продаю стіл','Шукаю квартиру'],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(forbidden.adsPolicy,'forbidden');
});

void test('obvious spam evidence overrides source topic assumptions', () => {
  const facts = deriveWhatsappQualification({
    groupInfoText:'950 participants',
    mainText:'Today',
    messageTexts:['Crypto signals Bitcoin airdrop','Casino betting','Forex crypto signals'],
    messageMeta:[],
    headerTitles:['Українці Berlin'],
  });
  assert.equal(facts.topicMatch,'mismatch');
});

void test('joined admin-only chat reports factual non-writeability', () => {
  const result = classifyWhatsAppSnapshot(
    { ...task, action:'inspect' },
    {
      targetTexts:[],
      targetHeadings:[],
      headerTitles:['Українці Варшава'],
      buttons:[],
      bodyText:'Only admins can send messages',
      mainText:'Today',
      composer:false,
      adminOnly:true,
    },
  );
  assert.equal(result.kind,'result');
  assert.equal(result.result.membershipState,'joined');
  assert.equal(result.result.canWrite,false);
});


void test('message timestamps classify recent activity and clearly stale chats without guessing the middle window', () => {
  const now = Date.UTC(2026,8,24,12);
  const recent = deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Привіт'],
    messageMeta:['[10:15, 24/09/2026] User:'],
    nowMs:now,
  });
  assert.equal(recent.activityState,'active');

  const stale = deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Старе повідомлення'],
    messageMeta:['[10:15, 01/09/2026] User:'],
    nowMs:now,
    locale:'uk-UA',
  });
  assert.equal(stale.activityState,'dead');

  const uncertain = deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Повідомлення'],
    messageMeta:['[10:15, 18/09/2026] User:'],
    nowMs:now,
  });
  assert.equal(uncertain.activityState,undefined);
});

void test('message timestamp activity handles ISO year-first metadata without partial-year misparse', () => {
  const now=Date.UTC(2026,8,24,18);
  const recent=deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Привіт'],
    messageMeta:['[10:15, 2026-09-24] User:'],
    nowMs:now,
  });
  assert.equal(recent.activityState,'active');

  const stale=deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Старе'],
    messageMeta:['[10:15, 2026-08-30] User:'],
    nowMs:now,
  });
  assert.equal(stale.activityState,'dead');
});

void test('ambiguous WhatsApp dates use the observed browser locale and never guess without one', () => {
  const now=Date.UTC(2026,8,2,18);
  const us=deriveWhatsappQualification({
    groupInfoText:'900 participants', mainText:'', messageTexts:['Hello'],
    messageMeta:['[10:15, 09/01/2026] User:'], nowMs:now, locale:'en-US',
  });
  assert.equal(us.activityState,'active');

  const ua=deriveWhatsappQualification({
    groupInfoText:'900 participants', mainText:'', messageTexts:['Привіт'],
    messageMeta:['[10:15, 09/01/2026] User:'], nowMs:now, locale:'uk-UA',
  });
  assert.equal(ua.activityState,'dead');

  const unknown=deriveWhatsappQualification({
    groupInfoText:'900 participants', mainText:'', messageTexts:['Message'],
    messageMeta:['[10:15, 09/01/2026] User:'], nowMs:now,
  });
  assert.equal(unknown.activityState,undefined);
});

void test('invalid calendar metadata stays unknown instead of normalizing into another date', () => {
  const now=Date.UTC(2026,8,24,18);
  const invalid=deriveWhatsappQualification({
    groupInfoText:'900 participants',
    mainText:'',
    messageTexts:['Повідомлення'],
    messageMeta:['[10:15, 31/02/2026] User:'],
    nowMs:now,
  });
  assert.equal(invalid.activityState,undefined);
});

void test('exact invite identity may resolve an approximate non-generated source name to the observed WhatsApp name', () => {
  const result = classifyWhatsAppSnapshot(task, {
    url:'https://web.whatsapp.com/accept?code=AbCdEfGh1234',
    targetHeadings:['Українці Варшава | Допомога'],
    targetTexts:['Українці Варшава | Допомога'],
    headerTitles:[],
    buttons:['Join group'],
    bodyText:'Join group',
  });
  assert.equal(result.kind,'action');
  assert.equal(result.observedName,'Українці Варшава | Допомога');
  assert.equal(result.action,'join');
});


void test('confirmed-send WhatsApp autopost helper is exported and target normalization remains exact', () => {
  assert.equal(typeof sendWhatsappAutopostViaCdp, 'function');
  assert.equal(normalizeTargetLabel('Українці Berlin'), normalizeTargetLabel('  УКРАЇНЦІ   Berlin '));
  assert.notEqual(normalizeTargetLabel('Українці Berlin'), normalizeTargetLabel('Українці Hamburg'));
});


void test('Work OS pairing token helper is exported and remains part of the loopback-only CDP surface',()=>{
  assert.equal(typeof readWorkOsExecutorTokenViaCdp,'function');
  assert.equal(normalizeLocalCdpBaseUrl('http://127.0.0.1:9222'),'http://127.0.0.1:9222');
  assert.equal(normalizeLocalCdpBaseUrl('http://192.168.1.5:9222'),null);
});


void test('WhatsApp inspect and leave share one bounded operation timeout instead of resetting 45s at every UI phase',()=>{
  const deadlineUses=[...source.matchAll(/const operationDeadline = Date\.now\(\) \+ timeoutMs;/g)].length;
  assert.ok(deadlineUses>=2);
  assert.match(source,/remainingBudget = \(\) => Math\.max\(POLL_MS, operationDeadline - Date\.now\(\)\)/);
  assert.doesNotMatch(source,/waitForClassification\(client, observedTask, timeoutMs, 'view'/);
  assert.doesNotMatch(source,/waitForClassification\(client, observedTask, timeoutMs, action/);
});

void test('WhatsApp autopost never sends or confirms after its 90s lease',()=>{
  const start=source.indexOf('export async function sendWhatsappAutopostViaCdp');
  const block=source.slice(start,source.indexOf('export async function readWhatsappHomeHealthViaCdp',start));
  assert.match(source,/const AUTOPOST_SEND_CONFIRM_MS = 30_000;/);
  assert.match(block,/const operationDeadline = Date\.now\(\) \+ timeoutMs;/);
  assert.doesNotMatch(block,/waitForClassification\([^)]*\btimeoutMs\b/);
  assert.doesNotMatch(block,/Date\.now\(\) ?\+ ?timeoutMs;[\s\S]*Date\.now\(\) ?\+ ?timeoutMs/);
  assert.equal([...block.matchAll(/autopost_budget_exhausted/g)].length,2);
  assert.equal([...block.matchAll(/Date\.now\(\) ?\+ ?confirmWindowMs/g)].length,2);
  const sendClick=block.indexOf("type:'keyDown', key:'Enter'");
  assert.ok(block.lastIndexOf('autopost_budget_exhausted',sendClick)>block.indexOf('waitForComposerText'));
});


void test('local Discovery checks high-signal Ukrainian candidates before malformed low-signal rows without changing qualification criteria',()=>{
  assert.match(source,/const priority=\(item\)=>/);
  assert.match(source,/score\+=8/);
  assert.match(source,/score-=8/);
  assert.match(source,/\.sort\(\(a,b\)=>priority\(b\)-priority\(a\)\)/);
});


void test('current WhatsApp header and composer surfaces are included in factual qualification',()=>{
  assert.match(source,/const headerText = clean\(main\?\.querySelector\('header'\)\?\.innerText/);
  assert.match(source,/headerText,/);
  assert.match(source,/#main \[contenteditable="true"\]\[role="textbox"\]/);
});

void test('browser-local task reader accepts a temporary skip list so one incomplete candidate cannot block the queue',()=>{
  assert.match(source,/skipCandidateIds=\[\]/);
  assert.match(source,/!skipped\.has\(item\.id\)/);
});


void test('noisy source labels are treated as weak identity hints instead of exact WhatsApp names',()=>{
  assert.match(source,/text\.length>140/);
  assert.match(source,/\\\/groups\\\//);
  assert.match(source,/ref=share/);
  assert.match(source,/\\bviews\?\\b/);
});


void test('joined WhatsApp qualification waits for the chat UI before reading facts',()=>{
  assert.match(source,/async function waitForJoinedChatReady/);
  assert.match(source,/messagesLoadingPattern/);
  assert.match(source,/\(latest\.composer===true\|\|latest\.adminOnly===true\)&&hasHeader/);
  assert.match(source,/const before ?= ?await waitForJoinedChatReady\(client\)/);
});

void test('topic match can use repeated factual Ukrainian message evidence inside the joined chat',()=>{
  assert.match(source,/ukrainianConversationPattern/);
  assert.match(source,/ukrainianMessages >= 2/);
});


void test('verified joined chat opens group info through the profile-details control',()=>{
  assert.match(source,/profileButton && !profileButton\.hasAttribute\('disabled'\)/);
  assert.match(source,/profileButton\.click\(\)/);
});


void test('exact invite join can bind the resulting joined header without waiting for a join system message',()=>{
  assert.match(source,/afterAction === 'join'/);
  assert.match(source,/snapshot\.joinConfirmedAfterExactInvite = true/);
  assert.match(source,/snapshot\.joinConfirmedAfterExactInvite === true/);
});


void test('WhatsApp Discovery queries invite facts before expensive navigation',()=>{
  assert.match(source,/export async function queryWhatsappInviteViaCdp/);
  assert.match(source,/WAWebGroupQueryJob/);
  assert.match(source,/queryGroupInvite/);
  assert.match(source,/membershipApprovalMode/);
  assert.match(source,/announce/);
  assert.match(source,/memberCount/);
});


void test('executor token bridge survives a closed Discovery dialog via browser-local credential storage', async()=>{
  const source=await import('node:fs/promises').then(({readFile})=>readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8'));
  const panel=await import('node:fs/promises').then(({readFile})=>readFile(new URL('../components/chat-discovery-executor-panel.tsx',import.meta.url),'utf8'));
  assert.match(source,/localStorage\.getItem\('work-os:executor-token:v1'\)/);
  assert.match(source,/stored\.startsWith\('wos_exec_'\)/);
  assert.match(panel,/localStorage\.setItem\(EXECUTOR_TOKEN_STORAGE_KEY,nextToken\)/);
  assert.match(panel,/EXECUTOR_DEVICE_STORAGE_KEY/);
});


void test('foreign solidarity group is not treated as a Ukrainian audience from the word Ukraine alone',()=>{
  const facts=deriveWhatsappQualification({
    groupInfoText:'Israeli Friends Of Ukraine · 954 учасники',
    headerText:'ישראלי | נתונים באהבה',
    headerTitles:['Israeli Friends Of Ukraine'],
    mainText:'',
    messageTexts:[],
    messageMeta:[],
  });
  assert.equal(facts.memberCount,954);
  assert.equal(facts.topicMatch,'mismatch');
});

void test('localized admin-only evidence overrides stale writable invite metadata',()=>{
  assert.match(source,/лише адміністратор\(\?:и\|ам\)/);
  assert.match(source,/latest\.composer===true\|\|latest\.adminOnly===true/);
  assert.match(source,/before\.adminOnly===true\?false/);
  assert.ok(source.indexOf('...preflightFacts')<source.indexOf('canWrite:liveCanWrite'));
});

void test('waiting check does not reload WhatsApp Web while it is still syncing messages',()=>{
  const guardAt=source.indexOf('while(shouldDeferForGlobalWhatsAppLoading(await readSnapshot(client).catch(()=>null))){');
  const navigateAt=source.indexOf("await client.send('Page.navigate',{url:targetUrl});",guardAt);
  assert.ok(guardAt>0&&navigateAt>guardAt);
  assert.match(source,/beforeNavigate:true/);
});

void test('waiting check waits out the WhatsApp sync caused by opening the invite within the server lease',()=>{
  assert.match(source,/const WAITING_CHECK_TIMEOUT_MS = 100_000;/);
  assert.match(source,/enrich: false, waitThroughLoading: true \}\);/);
  assert.match(source,/if\(waitThroughLoading&&Date\.now\(\)\+POLL_MS<deadline\)\{/);
  assert.match(source,/waitForClassification\(client, currentTask, remainingBudget\(\), null, navigatedInviteCode, waitThroughLoading\)/);
});

void test('waiting check presses the Ukrainian "Запит на приєднання" button behind the approval notice',()=>{
  const result=classifyWhatsAppSnapshot(
    {...task,action:'waiting_check'},
    {
      targetTexts:['Українці Варшава'],
      headerTitles:[],
      buttons:['Скасувати','Запит на приєднання'],
      bodyText:'Українці Варшава\nАдміністратор має схвалити ваш запит.\nСкасувати\nЗапит на приєднання',
    },
  );
  assert.deepEqual(result,{kind:'action',action:'request',buttonText:'Запит на приєднання',observedName:'Українці Варшава'});
});

const waitingTask={platform:'whatsapp',runtime:'whatsapp_web',action:'waiting_check',name:'РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ',
  link:'https://chat.whatsapp.com/JPcm0pzgpJ16vzaYRGKsAs',expectedTarget:{name:'РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ',link:'https://chat.whatsapp.com/JPcm0pzgpJ16vzaYRGKsAs'}};

void test('waiting check accepts a joined group whose WhatsApp name differs only by "#" or emoji on the exact invite',()=>{
  const result=classifyWhatsAppSnapshot(waitingTask,{
    url:'https://web.whatsapp.com/',navigatedInviteCode:'JPcm0pzgpJ16vzaYRGKsAs',
    headerNames:['#РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ'],headerTitles:[],buttons:[],composer:true,
    bodyText:'#РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ\nНапишіть повідомлення',
  });
  assert.equal(result.kind,'result');
  assert.equal(result.result.membershipState,'joined');
  assert.equal(result.result.observedName,'#РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ');
});

void test('loose name matching never applies outside the exact invite',()=>{
  const result=classifyWhatsAppSnapshot(waitingTask,{
    url:'https://web.whatsapp.com/',headerNames:['#РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ'],headerTitles:[],buttons:[],composer:true,
    bodyText:'#РЕКЛАМА КОСТА ДЕЛЬ СОЛЬ',
  });
  assert.deepEqual(result,{kind:'blocked',reason:'target_not_verified'});
});

void test('waiting check reports a group the account was removed from',()=>{
  const result=classifyWhatsAppSnapshot(waitingTask,{
    url:'https://web.whatsapp.com/',navigatedInviteCode:'JPcm0pzgpJ16vzaYRGKsAs',headerNames:[],headerTitles:[],buttons:['Скасувати'],
    bodyText:'Ви не можете приєднатися до цієї групи, оскільки вас було вилучено.\nСкасувати',
  });
  assert.equal(result.kind,'result');
  assert.equal(result.result.reason,'whatsapp_removed_from_group');
});
