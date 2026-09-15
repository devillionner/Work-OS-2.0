import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isAuditAccessHost, secureTokenEqual } from '../lib/audit-access.ts';

void test('audit access is restricted to the exact HTTPS staging host', () => {
  assert.equal(isAuditAccessHost('https://work-os-2-staging.devillionner.workers.dev/audit-access'), true);
  assert.equal(isAuditAccessHost('https://work-os-2.devillionner.workers.dev/audit-access'), false);
  assert.equal(isAuditAccessHost('https://work-os-2-staging.devillionner.workers.dev.evil.test/audit-access'), false);
  assert.equal(isAuditAccessHost('http://work-os-2-staging.devillionner.workers.dev/audit-access'), false);
});

void test('audit access token comparison accepts only the exact secret', async () => {
  assert.equal(await secureTokenEqual('correct-token', 'correct-token'), true);
  assert.equal(await secureTokenEqual('correct-token', 'wrong-token'), false);
  assert.equal(await secureTokenEqual('', 'correct-token'), false);
});

void test('audit route requires a staging secret, same-origin POST and existing owner session creation', () => {
  const route = readFileSync(new URL('../app/audit-access/route.ts', import.meta.url), 'utf8');
  assert.match(route, /AUDIT_ACCESS_TOKEN/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /OWNER_EMAIL/);
  assert.match(route, /SELECT id FROM users WHERE lower\(email\)=\?1 LIMIT 1/);
  assert.match(route, /createSession\(owner\.id\)/);
  assert.doesNotMatch(route, /INSERT INTO users/);
});

void test('audit GET link can authenticate without rendering a password form first', () => {
  const route = readFileSync(new URL('../app/audit-access/route.ts', import.meta.url), 'utf8');
  assert.match(route, /searchParams\.get\('token'\)/);
  assert.match(route, /return createAuditSession\(request\)/);
  assert.match(route, /Referrer-Policy', 'no-referrer'/);
  assert.match(route, /Cache-Control', 'no-store'/);
});
