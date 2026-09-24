import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authenticateDiscoveryExecutor,
  createDiscoveryExecutorDevice,
  listDiscoveryExecutorDevices,
  revokeDiscoveryExecutorDevice,
} from '../lib/chat-discovery/executor-auth.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('executor pairing returns a one-time bearer token and stores only its hash', async (t) => {
  const db = await localDatabase(t);
  const paired = await createDiscoveryExecutorDevice(db, 'u', 'Opera runner', 100);
  assert.match(paired.token, /^wos_exec_[0-9a-f]{64}$/);
  assert.equal(paired.device.name, 'Opera runner');

  const stored = await db.prepare('SELECT token_hash FROM chat_discovery_executor_devices WHERE id=?1')
    .bind(paired.device.id).first();
  assert.notEqual(stored.token_hash, paired.token);
  assert.equal(stored.token_hash.length, 64);

  const authenticated = await authenticateDiscoveryExecutor(
    db,
    new Request('https://work-os.test/api/chat-discovery/executor', {
      headers: { Authorization: `Bearer ${paired.token}` },
    }),
    110,
  );
  assert.deepEqual(authenticated, { userId: 'u', deviceId: paired.device.id });
  const devices = await listDiscoveryExecutorDevices(db, 'u');
  assert.equal(devices[0].lastSeenAt, 110);
  assert.equal((await listDiscoveryExecutorDevices(db, 'other')).length, 0);
});

void test('revoked executor token fails closed and cannot authenticate again', async (t) => {
  const db = await localDatabase(t);
  const paired = await createDiscoveryExecutorDevice(db, 'u', 'Viber runner', 100);
  await revokeDiscoveryExecutorDevice(db, 'u', paired.device.id, 120);
  assert.equal((await listDiscoveryExecutorDevices(db, 'u')).length, 0);
  await assert.rejects(
    authenticateDiscoveryExecutor(
      db,
      new Request('https://work-os.test/api/chat-discovery/executor', {
        headers: { Authorization: `Bearer ${paired.token}` },
      }),
      130,
    ),
    /відкликано або він недійсний/,
  );
});
