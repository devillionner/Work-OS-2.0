import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDate } from '../lib/business-time.ts';
import { generateTelegramSchedule, saveTelegramScheduleSettings } from '../lib/chats/telegram-schedule.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;
const DATE=businessDate(NOW);

async function seedAccount(db){
  await db.prepare(`INSERT INTO telegram_accounts
    (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES ('a','u',1,'Account',1,0,1,1)`).run();
}
async function telegramChat(db,id){
  await seedChat(db,{id,platform:'telegram',status:'ready',joined:NOW-21600});
  await db.prepare(`UPDATE chats SET telegram_account_id='a' WHERE id=?1`).bind(id).run();
}

void test('manual scheduler blocks generation when selected eligible chats cannot fill every requested slot',async t=>{
  const db=await localDatabase(t);
  await seedAccount(db);
  await telegramChat(db,'one');
  await telegramChat(db,'two');
  await telegramChat(db,'not-selected');
  await saveTelegramScheduleSettings(db,{
    userId:'u',accountId:'a',expectedVersion:0,intervalMinutes:8,baseAt:NOW,
    selectionMode:'manual',manualChatIds:['one','two'],now:NOW,date:DATE,
  });

  await assert.rejects(
    generateTelegramSchedule(db,{userId:'u',accountId:'a',count:3,now:NOW,date:DATE}),
    /доступно лише 2 із вибраних чатів/,
  );
  assert.equal(await db.prepare(`SELECT COUNT(*) AS count FROM telegram_schedule_slots WHERE user_id='u' AND telegram_account_id='a'`).first('count'),0);

  const first=await generateTelegramSchedule(db,{userId:'u',accountId:'a',count:1,now:NOW,date:DATE});
  assert.deepEqual(first.slots.map(slot=>slot.chatId),['one']);
  await assert.rejects(
    generateTelegramSchedule(db,{userId:'u',accountId:'a',count:2,now:NOW,date:DATE}),
    /доступно лише 1 із вибраних чатів/,
  );
  const rows=(await db.prepare(`SELECT chat_id FROM telegram_schedule_slots WHERE user_id='u' AND telegram_account_id='a' ORDER BY sequence`).all()).results;
  assert.deepEqual(rows,[{chat_id:'one'}]);
});
