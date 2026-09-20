import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  appendMigrationReconciliation,
  reconcileMigrationChunk,
} from '../lib/legacy-reconciliation.ts';
import { MIGRATION_PHASES } from '../lib/legacy-migration.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('migration reconciliation verifies owner-scoped stable keys and detects a missing row', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at)
    VALUES ('chat-a','u','whatsapp','A','https://chat.whatsapp.com/a','https://chat.whatsapp.com/a','to_join',1,1),
           ('chat-foreign','other','whatsapp','Foreign','https://chat.whatsapp.com/f','https://chat.whatsapp.com/f','to_join',1,1)`).run();

  const missing = await reconcileMigrationChunk(db,'u','chats',[{id:'chat-a'},{id:'chat-b'}]);
  assert.equal(missing.expected,2);
  assert.equal(missing.actual,1);
  assert.equal(missing.ok,false);

  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at)
    VALUES ('chat-b','u','viber','B','https://vb.me/b','https://vb.me/b','to_join',1,1)`).run();
  const complete = await reconcileMigrationChunk(db,'u','chats',[{id:'chat-a'},{id:'chat-b'}]);
  assert.equal(complete.actual,2);
  assert.equal(complete.ok,true);
  assert.equal(complete.expectedChecksum,complete.actualChecksum);
});

void test('reconciliation supports profile and setting stable keys', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at)
    VALUES ('chat-profile','u','telegram','P','https://t.me/profile_test','https://t.me/profile_test','to_join',1,1)`).run();
  await db.prepare(`INSERT INTO chat_profiles
    (chat_id,cadence,weekdays_json,directions_json,note,review_status,source,updated_at)
    VALUES ('chat-profile','any','[]','[]','','draft','legacy',1)`).run();
  await db.prepare(`INSERT INTO user_settings(user_id,setting_key,value_json,updated_at)
    VALUES ('u','focus','{}',1)`).run();

  assert.equal((await reconcileMigrationChunk(db,'u','profiles',[{chatId:'chat-profile'}])).ok,true);
  assert.equal((await reconcileMigrationChunk(db,'u','settings',[{key:'focus'}])).ok,true);
});

void test('checksum chain advances only from the current migration cursor', async () => {
  const firstChunk={phase:'chats',expected:2,actual:2,expectedChecksum:'a',actualChecksum:'a',ok:true};
  const first=await appendMigrationReconciliation({},'chats',3,0,firstChunk);
  assert.equal(first.chats?.verified,2);
  await assert.rejects(
    appendMigrationReconciliation(first,'chats',3,0,{...firstChunk,expected:1,actual:1}),
    /не збігається з прогресом/,
  );
  const second=await appendMigrationReconciliation(first,'chats',3,2,{phase:'chats',expected:1,actual:1,expectedChecksum:'b',actualChecksum:'b',ok:true});
  assert.equal(second.chats?.verified,3);
  assert.equal(second.chats?.ok,true);
});

void test('migration route gates completion on reconciliation before marking source migrated', async () => {
  const source=await readFile(new URL('../app/api/imports/legacy/migrate/route.ts',import.meta.url),'utf8');
  assert.match(source,/reconcileMigrationChunk\(env\.DB, userId, phase, chunk\)/);
  assert.match(source,/reconciliationComplete\(reconciliation, MIGRATION_PHASES\)/);
  assert.ok(source.indexOf('reconcileMigrationChunk(env.DB') < source.indexOf("status = 'migrated'"));
  assert.ok(MIGRATION_PHASES.length > 0);
});
