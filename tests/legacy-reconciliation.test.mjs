import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  appendMigrationReconciliation,
  reconcileMigrationChunk,
} from '../lib/legacy-reconciliation.ts';
import { MIGRATION_PHASES } from '../lib/legacy-migration.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('migration reconciliation verifies complete owner-scoped records and detects missing or mismatched rows', async (t) => {
  const db = await localDatabase(t);
  const chat = (id,name,platform,link) => ({
    id,platform,name,link,normalizedLink:link,workflowStatus:'to_join',isPrivate:0,
    joinedAt:null,processedAt:null,snoozedUntil:null,archiveReason:null,archivedAt:null,
    note:'',legacyDate:null,payloadJson:'{}',createdAt:1,updatedAt:1,
    telegramAccountId:null,telegramAccountExplicit:0,
  });
  const chatA=chat('chat-a','A','whatsapp','https://chat.whatsapp.com/a');
  const chatB=chat('chat-b','B','viber','https://vb.me/b');

  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,
     archive_reason,archived_at,legacy_payload_json,created_at,updated_at,note,legacy_date,telegram_account_id)
    VALUES ('chat-a','u','whatsapp','A','https://chat.whatsapp.com/a','https://chat.whatsapp.com/a','to_join',0,NULL,NULL,NULL,
            NULL,NULL,'{}',1,1,'',NULL,NULL),
           ('chat-foreign','other','whatsapp','Foreign','https://chat.whatsapp.com/f','https://chat.whatsapp.com/f','to_join',0,NULL,NULL,NULL,
            NULL,NULL,'{}',1,1,'',NULL,NULL)`).run();

  const missing = await reconcileMigrationChunk(db,'u','chats',[chatA,chatB]);
  assert.equal(missing.expected,2);
  assert.equal(missing.actual,1);
  assert.equal(missing.ok,false);

  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,
     archive_reason,archived_at,legacy_payload_json,created_at,updated_at,note,legacy_date,telegram_account_id)
    VALUES ('chat-b','u','viber','Wrong','https://vb.me/b','https://vb.me/b','to_join',0,NULL,NULL,NULL,
            NULL,NULL,'{}',1,1,'',NULL,NULL)`).run();
  const mismatch = await reconcileMigrationChunk(db,'u','chats',[chatA,chatB]);
  assert.equal(mismatch.actual,2);
  assert.equal(mismatch.ok,false);
  assert.notEqual(mismatch.expectedChecksum,mismatch.actualChecksum);

  await db.prepare(`UPDATE chats SET name='B' WHERE id='chat-b' AND user_id='u'`).run();
  const complete = await reconcileMigrationChunk(db,'u','chats',[chatA,chatB]);
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

  assert.equal((await reconcileMigrationChunk(db,'u','profiles',[{
    chatId:'chat-profile',language:null,cadence:'any',weekdaysJson:'[]',directionsJson:'[]',
    note:'',reviewStatus:'draft',source:'legacy',updatedAt:1,
  }])).ok,true);
  assert.equal((await reconcileMigrationChunk(db,'u','settings',[{
    key:'focus',valueJson:'{}',updatedAt:1,
  }])).ok,true);
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
  const reconciliationSource=await readFile(new URL('../lib/legacy-reconciliation.ts',import.meta.url),'utf8');
  assert.match(reconciliationSource,/canonicalExpectedRecord/);
  assert.match(reconciliationSource,/canonicalActualRecord/);
  assert.match(reconciliationSource,/recordChecksum\(expectedRecords\)/);
  assert.ok(source.indexOf('reconcileMigrationChunk(env.DB') < source.indexOf("status = 'migrated'"));
  assert.ok(MIGRATION_PHASES.length > 0);
});


void test('reconciliation verifies owner-scoped Telegram schedule settings and slots', async (t) => {
  const db = await localDatabase(t);
  await db.prepare(`INSERT INTO telegram_accounts
    (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('u:tg1','u',1,'TG 1',1,1,1,1)`).run();
  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,joined_at,telegram_account_id,created_at,updated_at)
    VALUES ('schedule-chat','u','telegram','Schedule chat','https://t.me/schedule_chat','https://t.me/schedule_chat',
      'ready',1,'u:tg1',1,1)`).run();
  await db.prepare(`INSERT INTO telegram_schedule_settings
    (user_id,telegram_account_id,interval_minutes,base_at,selection_mode,manual_chat_ids_json,updated_at,version)
    VALUES ('u','u:tg1',15,100,'manual','["schedule-chat"]',10,0)`).run();
  await db.prepare(`INSERT INTO telegram_schedule_slots
    (id,user_id,telegram_account_id,sequence,scheduled_at,chat_id,status,completed_at,publication_id,created_at,updated_at,version)
    VALUES ('schedule-slot','u','u:tg1',1,115,'schedule-chat','pending',NULL,NULL,10,10,0)`).run();

  const settings = await reconcileMigrationChunk(db,'u','scheduleSettings',[{
    accountId:'u:tg1', intervalMinutes:15, baseAt:100, selectionMode:'manual',
    manualChatIdsJson:'["schedule-chat"]', updatedAt:10, version:0,
  }]);
  assert.equal(settings.ok,true);

  const slots = await reconcileMigrationChunk(db,'u','scheduleSlots',[{
    id:'schedule-slot', accountId:'u:tg1', sequence:1, scheduledAt:115, chatId:'schedule-chat',
    status:'pending', completedAt:null, publicationId:null, createdAt:10, updatedAt:10, version:0,
  }]);
  assert.equal(slots.ok,true);

  const foreign = await reconcileMigrationChunk(db,'other','scheduleSlots',[{
    id:'schedule-slot', accountId:'u:tg1', sequence:1, scheduledAt:115, chatId:'schedule-chat',
    status:'pending', completedAt:null, publicationId:null, createdAt:10, updatedAt:10, version:0,
  }]);
  assert.equal(foreign.ok,false);
});
