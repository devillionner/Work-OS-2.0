import assert from 'node:assert/strict';
import test from 'node:test';
import { isGeneratedChatName, resolveChatName, shouldAutoApplyResolvedName } from '../lib/chats/name-resolution.ts';

void test('resolver reads a real Telegram title and decodes entities', async () => {
  const result = await resolveChatName('https://t.me/school_parents', async () =>
    new Response('<html><head><meta property="og:title" content="Батьки &amp; школа 👨‍👩‍👧"></head></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
  assert.equal(result?.name, 'Батьки & школа 👨‍👩‍👧');
  assert.equal(result?.platform, 'telegram');
});

void test('generic provider titles are rejected and generated placeholders are safe to replace', async () => {
  const result = await resolveChatName('https://chat.whatsapp.com/AbCdEf', async () =>
    new Response('<title>WhatsApp Group Invite</title>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(result, null);
  assert.equal(isGeneratedChatName('WhatsApp · AbCdEf', 'https://chat.whatsapp.com/AbCdEf'), true);
  assert.equal(shouldAutoApplyResolvedName('WhatsApp · AbCdEf', 'https://chat.whatsapp.com/AbCdEf', 'Parents Berlin'), true);
  assert.equal(shouldAutoApplyResolvedName('Ручна назва', 'https://chat.whatsapp.com/AbCdEf', 'Parents Berlin'), false);
});

void test('resolver refuses redirects outside the platform allowlist', async () => {
  let calls = 0;
  const result = await resolveChatName('https://invite.viber.com/?g=AbCd', async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'https://example.com/private' } });
  });
  assert.equal(result, null);
  assert.equal(calls, 1);
});
