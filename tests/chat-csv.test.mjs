import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChatCsvImport, exportChatCsv, parseChatCsv, previewChatCsvImport, serializeChatCsv } from '../lib/chats/csv.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;

async function account(db,id,owner,number){
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES (?1,?2,?3,?4,1,0,1,1)`).bind(id,owner,number,`TG ${number}`).run();
}
async function sourceChat(db,{accountNumber=2,name='=Мами Київ'}={}){
  const accountId=`u-${accountNumber}`;await account(db,accountId,'u',accountNumber);
  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,joined_at,processed_at,snoozed_until,archive_reason,archived_at,telegram_account_id,created_at,updated_at)
    VALUES ('source','u','telegram',?1,'https://t.me/sourcechat','https://t.me/sourcechat','archived',0,10,11,12,'Не актуальний',13,?2,5,20)`)
    .bind(name,accountId).run();
  await db.prepare(`INSERT INTO chat_profiles
    (chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
    VALUES ('source','uk','custom','[1,3]',9,'2026-09-20','["Математика","Англійська"]','@важлива нотатка','confirmed','manual',20)`).run();
}

void test('CSV export and import preserve current chat state, profile and Telegram account number', async t=>{
  const db=await localDatabase(t);await sourceChat(db);await account(db,'other-2','other',2);
  const csv=await exportChatCsv(db,'u');
  assert.match(csv,/work_os_chat_csv_version/);
  assert.match(csv,/\t=Мами Київ/);
  const rows=parseChatCsv(csv);
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'=Мами Київ');
  assert.equal(rows[0].profile.note,'@важлива нотатка');
  const preview=await previewChatCsvImport(db,'other',rows);
  assert.equal(preview.add,1);assert.equal(preview.existing,0);assert.deepEqual(preview.conflicts,[]);
  const result=await applyChatCsvImport(db,{userId:'other',rows,expectedRevision:preview.revision,now:NOW});
  assert.equal(result.inserted,1);
  const chat=await db.prepare(`SELECT c.*,a.account_number FROM chats c LEFT JOIN telegram_accounts a ON a.id=c.telegram_account_id WHERE c.user_id='other' AND c.normalized_link='https://t.me/sourcechat'`).first();
  assert.equal(chat.name,'=Мами Київ');assert.equal(chat.workflow_status,'archived');assert.equal(chat.joined_at,10);assert.equal(chat.processed_at,11);
  assert.equal(chat.snoozed_until,12);assert.equal(chat.archive_reason,'Не актуальний');assert.equal(chat.archived_at,13);assert.equal(chat.created_at,5);assert.equal(chat.updated_at,20);assert.equal(chat.account_number,2);
  const profile=await db.prepare(`SELECT * FROM chat_profiles WHERE chat_id=?1`).bind(chat.id).first();
  assert.equal(profile.language,'uk');assert.equal(profile.cadence,'custom');assert.equal(profile.custom_interval_days,9);assert.equal(profile.next_allowed_on,'2026-09-20');
  assert.equal(profile.weekdays_json,'[1,3]');assert.equal(profile.directions_json,'["Математика","Англійська"]');assert.equal(profile.note,'@важлива нотатка');assert.equal(profile.review_status,'confirmed');
});

void test('re-import is missing-only and never overwrites a trusted existing chat', async t=>{
  const db=await localDatabase(t);await sourceChat(db);await account(db,'other-2','other',2);
  const rows=parseChatCsv(await exportChatCsv(db,'u'));
  let preview=await previewChatCsvImport(db,'other',rows);
  await applyChatCsvImport(db,{userId:'other',rows,expectedRevision:preview.revision,now:NOW});
  await db.prepare(`UPDATE chats SET name='Ручна перевірена назва',updated_at=999 WHERE user_id='other' AND normalized_link='https://t.me/sourcechat'`).run();
  preview=await previewChatCsvImport(db,'other',rows);
  assert.equal(preview.add,0);assert.equal(preview.existing,1);
  const result=await applyChatCsvImport(db,{userId:'other',rows,expectedRevision:preview.revision,now:NOW+1});
  assert.equal(result.inserted,0);
  assert.equal((await db.prepare(`SELECT name FROM chats WHERE user_id='other' AND normalized_link='https://t.me/sourcechat'`).first()).name,'Ручна перевірена назва');
});

void test('missing Telegram account blocks preview instead of silently remapping the chat', async t=>{
  const db=await localDatabase(t);await sourceChat(db,{accountNumber:3});
  const rows=parseChatCsv(await exportChatCsv(db,'u'));
  const preview=await previewChatCsvImport(db,'other',rows);
  assert.equal(preview.add,0);assert.equal(preview.conflicts.length,1);assert.match(preview.conflicts[0],/#3/);
  await assert.rejects(applyChatCsvImport(db,{userId:'other',rows,expectedRevision:preview.revision,now:NOW}),/Telegram-акаунт #3/);
});

void test('revision guard rejects an apply after workspace data changed', async t=>{
  const db=await localDatabase(t);await sourceChat(db);await account(db,'other-2','other',2);
  const rows=parseChatCsv(await exportChatCsv(db,'u'));
  const preview=await previewChatCsvImport(db,'other',rows);
  await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
    VALUES ('race','other','whatsapp','Race','https://chat.whatsapp.com/abcdefghij','https://chat.whatsapp.com/abcdefghij','to_join',1,1,1)`).run();
  await assert.rejects(applyChatCsvImport(db,{userId:'other',rows,expectedRevision:preview.revision,now:NOW}),/змінилися після preview/);
});

void test('parser handles quoted cells and rejects duplicate canonical links',()=>{
  const base={
    work_os_chat_csv_version:'work-os-chat-csv-v1',platform:'telegram',name:'Чат, "Київ"',link:'https://t.me/quotedchat',workflow_status:'to_join',
    joined_at:'',processed_at:'',snoozed_until:'',archive_reason:'',archived_at:'',created_at:'1',updated_at:'2',telegram_account_number:'',
    has_profile:'1',profile_language:'uk',profile_cadence:'daily',profile_weekdays_json:'[1,2]',profile_custom_interval_days:'',profile_next_allowed_on:'',
    profile_directions_json:'["Математика"]',profile_note:'Нотатка, з комою',profile_review_status:'draft',
  };
  const csv=serializeChatCsv([base]);
  const parsed=parseChatCsv(csv);
  assert.equal(parsed[0].name,'Чат, "Київ"');assert.equal(parsed[0].profile.note,'Нотатка, з комою');
  assert.throws(()=>parseChatCsv(serializeChatCsv([base,{...base,name:'Інша назва'}])),/повторюється у CSV/);
});
