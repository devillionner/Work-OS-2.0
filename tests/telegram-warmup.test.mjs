import assert from 'node:assert/strict';
import test from 'node:test';
import { changeTelegramWarmupReady, readTelegramWarmup } from '../lib/chats/telegram-warmup.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;

async function seedAccount(db,id='a',owner='u') {
  await db.prepare(`INSERT INTO telegram_accounts(id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at)
    VALUES (?1,?2,1,'A',1,1,?3,?3)`).bind(id,owner,NOW-1000).run();
}
async function eventForAccount(db,input,accountId='a') {
  await seedEvent(db,input);
  await db.prepare(`UPDATE activity_events SET telegram_account_id=?1 WHERE id=?2`).bind(accountId,input.id).run();
}

void test('warmup progress is derived from account-scoped join and publication events', async t=>{
  const db=await localDatabase(t);await seedAccount(db);
  let snapshot=await readTelegramWarmup(db,'u','a');
  assert.equal(snapshot.joinedCount,0);assert.equal(snapshot.publicationCount,0);assert.equal(snapshot.ready,false);
  await assert.rejects(changeTelegramWarmupReady(db,{userId:'u',accountId:'a',ready:true,now:NOW}),/перше приєднання/);

  await eventForAccount(db,{id:'join',owner:'u',type:'chat_joined',date:'2026-09-10',at:NOW-20});
  await eventForAccount(db,{id:'pub',owner:'u',type:'publication',date:'2026-09-10',at:NOW-10});
  await eventForAccount(db,{id:'foreign',owner:'other',type:'publication',date:'2026-09-10',at:NOW-5});
  snapshot=await readTelegramWarmup(db,'u','a');
  assert.equal(snapshot.joinedCount,1);assert.equal(snapshot.publicationCount,1);
  assert.deepEqual(snapshot.steps.map(step=>step.done),[true,true,true,false]);
});

void test('warmup ready state is auditable and reversible without changing work events', async t=>{
  const db=await localDatabase(t);await seedAccount(db);
  await eventForAccount(db,{id:'join',owner:'u',type:'chat_joined',date:'2026-09-10',at:NOW-20});
  await eventForAccount(db,{id:'pub',owner:'u',type:'publication',date:'2026-09-10',at:NOW-10});
  const before=Number((await db.prepare(`SELECT COUNT(*) count FROM activity_events WHERE event_type IN ('chat_joined','publication')`).first()).count);

  let snapshot=await changeTelegramWarmupReady(db,{userId:'u',accountId:'a',ready:true,now:NOW});
  assert.equal(snapshot.ready,true);assert.equal(snapshot.readyAt,NOW);
  snapshot=await changeTelegramWarmupReady(db,{userId:'u',accountId:'a',ready:false,now:NOW+1});
  assert.equal(snapshot.ready,false);assert.equal(snapshot.readyAt,null);
  const after=Number((await db.prepare(`SELECT COUNT(*) count FROM activity_events WHERE event_type IN ('chat_joined','publication')`).first()).count);
  assert.equal(after,before);
  const actions=(await db.prepare(`SELECT metadata_json FROM activity_events WHERE event_type='telegram_warmup_state' ORDER BY rowid`).all()).results.map(row=>JSON.parse(row.metadata_json).action);
  assert.deepEqual(actions,['complete','reopen']);
});

void test('warmup cannot read or update another owners account', async t=>{
  const db=await localDatabase(t);await seedAccount(db,'foreign','other');
  await assert.rejects(readTelegramWarmup(db,'u','foreign'),/не знайдено/);
  await assert.rejects(changeTelegramWarmupReady(db,{userId:'u',accountId:'foreign',ready:true,now:NOW}),/не знайдено/);
});
