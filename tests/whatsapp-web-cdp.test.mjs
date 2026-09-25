import assert from 'node:assert/strict';
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
  assert.equal('topicMatch' in result.result, false);
});

void test('known invalid invite can be reported inaccessible without claiming target verification', () => {
  const result = classifyWhatsAppSnapshot(task, {
    targetTexts: [],
    headerTitles: [],
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
