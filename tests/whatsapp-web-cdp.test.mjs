import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWhatsAppSnapshot,
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
  assert.equal(result.result.adsPolicy, 'unknown');
  assert.equal(result.result.activityState, 'unknown');
  assert.equal(result.result.topicMatch, 'unknown');
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

void test('generated placeholder names never satisfy exact target verification', () => {
  const generatedTask = {
    ...task,
    name: 'WhatsApp · AbCdEfGh',
    expectedTarget: {
      ...task.expectedTarget,
      name: 'WhatsApp · AbCdEfGh',
    },
  };
  const result = classifyWhatsAppSnapshot(generatedTask, {
    targetTexts: ['WhatsApp · AbCdEfGh'],
    headerTitles: [],
    buttons: ['Join group'],
    bodyText: 'Join group',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'target_not_verified' });
});
