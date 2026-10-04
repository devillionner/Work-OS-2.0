import assert from 'node:assert/strict';
import test from 'node:test';

import { handleLiveRequest, resolveLiveCaller } from '../workers/live-gateway.js';
import { createDiscoveryExecutorDevice } from '../lib/chat-discovery/executor-auth.ts';
import { sha256Hex } from '../lib/session-user.ts';
import { localDatabase } from './helpers/local-d1.mjs';

// /api/live runs at the Worker level before vinext (vinext cannot return a 101 upgrade). These tests
// cover its auth and what it forwards to the owner Durable Object; the 101 itself only exists in the
// real Workers runtime and was verified live on staging.
const NOW = 1_800_000_000;
const BASE = 'https://work-os.example.test/api/live';

async function seedSession(db, token) {
  await db.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?1,'u',1,?2)`).bind(await sha256Hex(token), NOW + 3600).run();
}

function upgrade(url, headers = {}) {
  return new Request(url, { headers: { Upgrade: 'websocket', ...headers } });
}

void test('a browser is identified by its session cookie and a runner by its executor token', async (t) => {
  const db = await localDatabase(t);
  await seedSession(db, 'session-token');
  const paired = await createDiscoveryExecutorDevice(db, 'u', 'Opera runner', NOW - 10);

  assert.deepEqual(await resolveLiveCaller(db, upgrade(`${BASE}?kind=browser`, { Cookie: 'a=b; work_os_session=session-token' }), NOW), { kind: 'browser', userId: 'u', deviceId: '' });
  assert.equal(await resolveLiveCaller(db, upgrade(`${BASE}?kind=browser`, { Cookie: 'work_os_session=wrong' }), NOW), null);
  assert.equal(await resolveLiveCaller(db, upgrade(`${BASE}?kind=browser`), NOW), null);

  assert.deepEqual(await resolveLiveCaller(db, upgrade(`${BASE}?kind=runner&token=${paired.token}`), NOW), { kind: 'runner', userId: 'u', deviceId: paired.device.id });
  assert.equal(await resolveLiveCaller(db, upgrade(`${BASE}?kind=runner&token=wos_exec_wrong`), NOW), null);
  // A runner token never authenticates a browser socket and a session cookie never a runner socket.
  assert.equal(await resolveLiveCaller(db, upgrade(`${BASE}?kind=runner`, { Cookie: 'work_os_session=session-token' }), NOW), null);
});

void test('the DO receives the authenticated userId and deviceId, never values supplied by the client', async (t) => {
  const db = await localDatabase(t);
  await seedSession(db, 'session-token');
  const paired = await createDiscoveryExecutorDevice(db, 'u', 'Opera runner', NOW - 10);
  const forwarded = [];
  const env = {
    DB: db,
    OWNER_CHANNEL: {
      idFromName: (name) => `id:${name}`,
      get: (id) => ({ fetch: async (request) => { forwarded.push({ id, url: new URL(request.url) }); return new Response(null, { status: 204 }); } }),
    },
  };

  await handleLiveRequest(upgrade(`${BASE}?kind=browser&userId=victim&deviceId=forged`, { Cookie: 'work_os_session=session-token' }), env);
  await handleLiveRequest(upgrade(`${BASE}?kind=runner&token=${paired.token}&userId=victim`), env);

  assert.equal(forwarded[0].id, 'id:u');
  assert.equal(forwarded[0].url.searchParams.get('userId'), 'u');
  assert.equal(forwarded[0].url.searchParams.get('deviceId'), null);
  assert.equal(forwarded[1].id, 'id:u');
  assert.equal(forwarded[1].url.searchParams.get('userId'), 'u');
  assert.equal(forwarded[1].url.searchParams.get('deviceId'), paired.device.id);
  assert.equal(forwarded[1].url.searchParams.get('token'), null, 'the token never reaches the DO');

  assert.equal((await handleLiveRequest(new Request(BASE), env)).status, 426);
  assert.equal((await handleLiveRequest(upgrade(`${BASE}?kind=browser`), env)).status, 401);
  assert.equal(forwarded.length, 2);
});
