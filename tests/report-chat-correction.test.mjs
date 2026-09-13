import assert from 'node:assert/strict';
import test from 'node:test';
import { readHistoricalChatAccounts, recordHistoricalJoinedChat } from '../lib/reports/chat-correction.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const DATE='2026-09-10';
const NOW=Math.floor(Date.parse('2026-09-13T12:00:00Z')/1000);

async function seedAccounts(db){
  await db.prepare(`INSERT INTO telegram_accounts
    (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('u:tg1','u',1,'TG 1',1,1,1,1),
           ('other:tg1','other',1,'TG 1',1,1,1,1)`).run();
}

void test('historical joined chat is idempotent, canonical and does not mutate current Telegram warm-up state',async t=>{
  const db=await localDatabase(t);
  await seedAccounts(db);
  await db.prepare(`UPDATE telegram_accounts SET join_streak=4,break_until=?1,updated_at=55 WHERE id='u:tg1'`).bind(NOW+3600).run();
  const requestId=crypto.randomUUID();
  const result=await recordHistoricalJoinedChat(db,{
    userId:'u',requestId,date:DATE,name:'  Test   Group  ',link:'https://telegram.me/TestGroup?utm_source=x',telegramAccountId:'u:tg1',now:NOW,
  });

  assert.equal(result.platform,'telegram');
  assert.equal(result.link,'https://t.me/testgroup');
  assert.equal(result.name,'Test Group');
  assert.deepEqual(await db.prepare(`SELECT workflow_status,joined_at,processed_at,telegram_account_id,created_at,updated_at
    FROM chats WHERE id=?1`).bind(result.chatId).first(),{
      workflow_status:'ready',joined_at:null,processed_at:null,telegram_account_id:'u:tg1',created_at:NOW,updated_at:NOW,
    });
  const events=(await db.prepare(`SELECT event_type,occurred_at,event_date,metadata_json,source_key FROM activity_events
    WHERE user_id='u' AND chat_id=?1 ORDER BY rowid`).bind(result.chatId).all()).results;
  assert.deepEqual(events.map(event=>event.event_type),['chat_state_changed','chat_joined']);
  assert.ok(events.every(event=>Number(event.occurred_at)===NOW&&event.event_date===DATE));
  const joinedMetadata=JSON.parse(events[1].metadata_json);
  assert.equal(joinedMetadata.correction,'historical_report');
  assert.equal(joinedMetadata.accountingDate,DATE);
  assert.equal(joinedMetadata.exactJoinTime,'unknown');
  assert.deepEqual(await db.prepare(`SELECT join_streak,break_until,updated_at FROM telegram_accounts WHERE id='u:tg1'`).first(),{
    join_streak:4,break_until:NOW+3600,updated_at:55,
  });

  const replay=await recordHistoricalJoinedChat(db,{
    userId:'u',requestId,date:DATE,name:'Test Group',link:'https://t.me/testgroup',telegramAccountId:'u:tg1',now:NOW,
  });
  assert.equal(replay.chatId,result.chatId);
  assert.equal(await db.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id='u'`).first('count'),1);
  assert.equal(await db.prepare(`SELECT COUNT(*) AS count FROM activity_events WHERE user_id='u' AND chat_id=?1`).bind(result.chatId).first('count'),2);

  await assert.rejects(recordHistoricalJoinedChat(db,{
    userId:'u',requestId,date:DATE,name:'Other',link:'https://t.me/othergroup',telegramAccountId:'u:tg1',now:NOW,
  }),/ID запиту вже використано/);
  await assert.rejects(recordHistoricalJoinedChat(db,{
    userId:'u',requestId:crypto.randomUUID(),date:DATE,name:'Duplicate alias',link:'https://telegram.dog/TestGroup',telegramAccountId:'u:tg1',now:NOW,
  }),/існує/);
  await assert.rejects(recordHistoricalJoinedChat(db,{
    userId:'u',requestId:crypto.randomUUID(),date:'2026-09-14',name:'Future',link:'https://t.me/futuregroup',telegramAccountId:'u:tg1',now:NOW,
  }),/майбутньому/);
  await assert.rejects(recordHistoricalJoinedChat(db,{
    userId:'u',requestId:crypto.randomUUID(),date:DATE,name:'Foreign account',link:'https://t.me/foreignacct',telegramAccountId:'other:tg1',now:NOW,
  }),/не належить/);
});

void test('historical chat account list is owner scoped',async t=>{
  const db=await localDatabase(t);
  await seedAccounts(db);
  const accounts=await readHistoricalChatAccounts(db,'u');
  assert.ok(accounts.length>=1);
  assert.ok(accounts.every(account=>account.id.startsWith('u:')));
  assert.ok(accounts.every(account=>!account.id.startsWith('other:')));
});
