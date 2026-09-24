import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import {
  AuthIdentityError,
  createGoogleAuthPolicy,
  resolveGoogleIdentity,
} from '../lib/auth-identities.ts';

async function database(t) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.prepare(`CREATE TABLE users(
    id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,
    picture_url TEXT,created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE auth_identities(
    provider TEXT NOT NULL,provider_subject TEXT NOT NULL,user_id TEXT NOT NULL,
    email TEXT NOT NULL,display_name TEXT NOT NULL,picture_url TEXT,
    created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL,
    PRIMARY KEY(provider,provider_subject),UNIQUE(provider,email)
  )`).run();
  return db;
}
const owner = {
  subject: 'google-owner-sub',
  email: 'Owner@Example.com',
  displayName: 'Owner',
  pictureUrl: 'https://example.com/owner.png',
};
const secondary = {
  subject: 'google-secondary-sub',
  email: 'second@example.com',
  displayName: 'Second account',
  pictureUrl: null,
};

void test('Google allowlist always includes owner and normalizes additional accounts', () => {
  const policy = createGoogleAuthPolicy(
    ' Owner@Example.com ',
    'SECOND@example.com; third@example.com\nfourth@example.com',
  );
  assert.ok(policy);
  assert.equal(policy.ownerEmail, 'owner@example.com');
  assert.deepEqual(
    [...policy.allowedEmails].sort(),
    ['fourth@example.com', 'owner@example.com', 'second@example.com', 'third@example.com'],
  );
});

void test('owner bootstrap keeps Google subject as canonical workspace id', async (t) => {
  const db = await database(t);
  const policy = createGoogleAuthPolicy(owner.email, secondary.email);
  assert.ok(policy);
  const userId = await resolveGoogleIdentity(db, owner, policy);
  assert.equal(userId, owner.subject);
  assert.equal(await db.prepare('SELECT email FROM users WHERE id=?1').bind(userId).first('email'), 'owner@example.com');
  assert.equal(await db.prepare('SELECT user_id FROM auth_identities WHERE provider_subject=?1').bind(owner.subject).first('user_id'), userId);
});
void test('secondary allowed Google identity opens the same workspace', async (t) => {
  const db = await database(t);
  const policy = createGoogleAuthPolicy(owner.email, secondary.email);
  assert.ok(policy);
  const ownerId = await resolveGoogleIdentity(db, owner, policy);
  const secondaryId = await resolveGoogleIdentity(db, secondary, policy);
  assert.equal(secondaryId, ownerId);
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM users').first('count'), 1);
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM auth_identities').first('count'), 2);
  assert.equal(
    await db.prepare('SELECT user_id FROM auth_identities WHERE provider_subject=?1')
      .bind(secondary.subject).first('user_id'),
    ownerId,
  );
});

void test('secondary account cannot bootstrap a workspace before the owner', async (t) => {
  const db = await database(t);
  const policy = createGoogleAuthPolicy(owner.email, secondary.email);
  assert.ok(policy);
  await assert.rejects(
    resolveGoogleIdentity(db, secondary, policy),
    (error) => error instanceof AuthIdentityError && error.code === 'owner_not_initialized',
  );
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM users').first('count'), 0);
});
void test('non-allowlisted Google identity is rejected without writes', async (t) => {
  const db = await database(t);
  const policy = createGoogleAuthPolicy(owner.email, secondary.email);
  assert.ok(policy);
  await resolveGoogleIdentity(db, owner, policy);
  await assert.rejects(
    resolveGoogleIdentity(
      db,
      { ...secondary, subject: 'intruder-sub', email: 'intruder@example.com' },
      policy,
    ),
    (error) => error instanceof AuthIdentityError && error.code === 'not_allowed',
  );
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM auth_identities').first('count'), 1);
});

void test('repeated secondary login is idempotent and never changes owner profile', async (t) => {
  const db = await database(t);
  const policy = createGoogleAuthPolicy(owner.email, secondary.email);
  assert.ok(policy);
  const ownerId = await resolveGoogleIdentity(db, owner, policy);
  await resolveGoogleIdentity(db, secondary, policy);
  await resolveGoogleIdentity(db, { ...secondary, displayName: 'Renamed secondary' }, policy);
  assert.equal(await db.prepare('SELECT COUNT(*) count FROM auth_identities').first('count'), 2);
  assert.deepEqual(
    await db.prepare('SELECT email,display_name FROM users WHERE id=?1').bind(ownerId).first(),
    { email: 'owner@example.com', display_name: 'Owner' },
  );
});
