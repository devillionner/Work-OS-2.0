import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessengerAutomationError,
  claimWhatsAppAutopostJob,
  completeWhatsAppAutopostJob,
  createWhatsAppAutopostJob,
  cancelWhatsAppAutopostJob,
  readLatestWhatsAppAutopostJob,
} from '../lib/messenger-automation.ts';
import { recordManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-24T12:00:00Z')/1000;
const DATE='2026-09-24';

async function seedAdvertisement(db,id='ad'){
  await db.prepare(`INSERT INTO library_items
    (id,user_id,kind,collection,version,title,uk_text,ru_text,tags_json,platforms_json,created_at,updated_at)
    VALUES (?1,'u','advertisement','advertisement',3,'WA ad','Тест WhatsApp','Тест WhatsApp RU','[]','["whatsapp"]',1,1)`)
    .bind(id).run();
}
async function seedDevice(db,id='device'){
  await db.prepare(`INSERT INTO chat_discovery_executor_devices(id,user_id,name,token_hash,created_at)
    VALUES (?1,'u','Device',?2,1)`).bind(id,'hash-'+id).run();
}
async function setup(t,suffix='one'){
  const db=await localDatabase(t);
  await seedChat(db,{id:'chat-'+suffix,owner:'u',platform:'whatsapp',status:'ready',joined:10});
  await db.prepare(`UPDATE chats SET name='Українці Berlin',link=?1,normalized_link=?1 WHERE id=?2`)
    .bind(`https://chat.whatsapp.com/Autopost${suffix}123`,`chat-${suffix}`).run();
  await seedAdvertisement(db,'ad-'+suffix);
  await seedDevice(db);
  const chat=await readChatState(db,'u',`chat-${suffix}`);
  return {db,chat,advertisementId:'ad-'+suffix};
}

void test('WhatsApp autopost reserves one eligible Library material and blocks concurrent manual publication',async t=>{
  const {db,chat,advertisementId}=await setup(t,'reserve');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_reserve',chatId:chat.id,
  },NOW,DATE);
  assert.equal(job.status,'pending');
  assert.equal(job.advertisementId,advertisementId);
  assert.equal(job.language,'uk');

  const manual=await recordManualPublication(db,{
    userId:'u',chat,accountId:null,advertisementId,language:'uk',quickMode:true,
    now:NOW+1,date:DATE,stateToken:chat.state_token,
  });
  assert.equal(manual.ok,false);
  assert.match(manual.error,/автопублікація/);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
});

void test('confirmed WhatsApp autopost creates exactly one canonical publication fact only after send confirmation',async t=>{
  const {db,chat}=await setup(t,'sent');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_sent',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u','device',NOW+1);
  assert.equal(task?.kind,'whatsapp_autopost');
  assert.equal(task?.target.expectedName,'Українці Berlin');
  assert.equal(task?.material.text,'Тест WhatsApp');
  assert.equal(task?.safety.createsPublication,'after_confirmed_send');

  const completed=await completeWhatsAppAutopostJob(db,'u','device',{
    jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
  },NOW+2);
  assert.equal(completed.status,'sent');
  assert.ok(completed.publicationId);
  const publication=await db.prepare(`SELECT source,source_key,advertisement_id FROM chat_publications
    WHERE user_id='u' AND chat_id=?1 AND published_on=?2`).bind(chat.id,DATE).first();
  assert.equal(publication.source,'whatsapp_autopost');
  assert.equal(publication.source_key,`whatsapp-autopost:${job.id}`);
  assert.equal(await db.prepare(`SELECT COUNT(*) FROM activity_events
    WHERE user_id='u' AND event_type='publication' AND cancelled_at IS NULL`).first('COUNT(*)'),1);
  assert.equal((await readLatestWhatsAppAutopostJob(db,'u'))?.status,'sent');

  const retry=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_sent',chatId:chat.id,
  },NOW+3,DATE);
  assert.equal(retry.id,job.id);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),1);
});

void test('wrong target or unconfirmed send fails closed with zero publication facts',async t=>{
  const {db,chat}=await setup(t,'wrong');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_wrong',chatId:chat.id,
  },NOW,DATE);
  await claimWhatsAppAutopostJob(db,'u','device',NOW+1);
  const completed=await completeWhatsAppAutopostJob(db,'u','device',{
    jobId:job.id,status:'sent',observedTarget:'Інший чат',targetVerified:true,sendConfirmed:true,
    errorCode:'wrong_target',
  },NOW+2);
  assert.equal(completed.status,'failed');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
  assert.equal(await db.prepare(`SELECT COUNT(*) FROM activity_events WHERE event_type='publication'`).first('COUNT(*)'),0);
});

void test('expired WhatsApp autopost lease cannot create a publication fact',async t=>{
  const {db,chat}=await setup(t,'expired');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_expired',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u','device',NOW+1);
  assert.ok(task);
  await assert.rejects(
    completeWhatsAppAutopostJob(db,'u','device',{
      jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
    },task.leaseExpiresAt),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
});


void test('confirmed send is still recorded if Library eligibility changes after the executor claim',async t=>{
  const {db,chat,advertisementId}=await setup(t,'factfirst');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_factfirst',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u','device',NOW+1);
  assert.ok(task);
  await db.prepare('UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2')
    .bind(NOW+2,advertisementId).run();

  const completed=await completeWhatsAppAutopostJob(db,'u','device',{
    jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
  },NOW+3);
  assert.equal(completed.status,'sent');
  assert.equal(await db.prepare(`SELECT COUNT(*) FROM chat_publications
    WHERE user_id='u' AND chat_id=?1 AND published_on=?2 AND source='whatsapp_autopost'`)
    .bind(chat.id,DATE).first('COUNT(*)'),1);
});


void test('claimed WhatsApp autopost cannot be cancelled while a send may be in flight',async t=>{
  const {db,chat}=await setup(t,'cancelrace');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_cancelrace',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u','device',NOW+1);
  assert.ok(task);
  await assert.rejects(
    cancelWhatsAppAutopostJob(db,'u',job.id,NOW+2),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
  const completed=await completeWhatsAppAutopostJob(db,'u','device',{
    jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
  },NOW+3);
  assert.equal(completed.status,'sent');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),1);
});
