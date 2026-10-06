import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessengerAutomationError,
  claimWhatsAppAutopostJob,
  completeWhatsAppAutopostJob,
  createWhatsAppAutopostBatch,
  createWhatsAppAutopostJob,
  cancelWhatsAppAutopostJob,
  readLatestWhatsAppAutopostJob,
  releaseWhatsAppAutopostJob,
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
  const task=await claimWhatsAppAutopostJob(db,'u',NOW+1);
  assert.equal(task?.kind,'whatsapp_autopost');
  assert.equal(task?.target.expectedName,'Українці Berlin');
  assert.equal(task?.material.text,'Тест WhatsApp');
  assert.equal(task?.safety.createsPublication,'after_confirmed_send');

  const completed=await completeWhatsAppAutopostJob(db,'u',{
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
  await claimWhatsAppAutopostJob(db,'u',NOW+1);
  const completed=await completeWhatsAppAutopostJob(db,'u',{
    jobId:job.id,status:'sent',observedTarget:'Інший чат',targetVerified:true,sendConfirmed:true,
    errorCode:'wrong_target',
  },NOW+2);
  assert.equal(completed.status,'failed');
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
  assert.equal(await db.prepare(`SELECT COUNT(*) FROM activity_events WHERE event_type='publication'`).first('COUNT(*)'),0);
});

void test('completing a job that is no longer claimed (released back to pending) fails closed',async t=>{
  const {db,chat}=await setup(t,'released');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_released',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u',NOW+1);
  assert.ok(task);
  // A runtime problem (or a dropped runner connection) puts the job back to 'pending' without a
  // result — the owner Durable Object's own connection is the only lease now, so nothing here times
  // out; see releaseWhatsAppAutopostJob and OwnerChannel.webSocketClose.
  assert.equal(await releaseWhatsAppAutopostJob(db,'u',job.id,NOW+2),true);
  await assert.rejects(
    completeWhatsAppAutopostJob(db,'u',{
      jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
    },NOW+3),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
});


void test('confirmed send is still recorded if Library eligibility changes after the executor claim',async t=>{
  const {db,chat,advertisementId}=await setup(t,'factfirst');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_factfirst',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u',NOW+1);
  assert.ok(task);
  await db.prepare('UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2')
    .bind(NOW+2,advertisementId).run();

  const completed=await completeWhatsAppAutopostJob(db,'u',{
    jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
  },NOW+3);
  assert.equal(completed.status,'sent');
  assert.equal(await db.prepare(`SELECT COUNT(*) FROM chat_publications
    WHERE user_id='u' AND chat_id=?1 AND published_on=?2 AND source='whatsapp_autopost'`)
    .bind(chat.id,DATE).first('COUNT(*)'),1);
});


void test('an operator cancel wins immediately even while a send may be in flight, fencing a later result',async t=>{
  const {db,chat}=await setup(t,'cancelrace');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_autopost_cancelrace',chatId:chat.id,
  },NOW,DATE);
  const task=await claimWhatsAppAutopostJob(db,'u',NOW+1);
  assert.ok(task);
  // No lease to wait out any more — the operator can cancel a claimed job right away.
  await cancelWhatsAppAutopostJob(db,'u',job.id,NOW+2);
  await assert.rejects(
    completeWhatsAppAutopostJob(db,'u',{
      jobId:job.id,status:'sent',observedTarget:'Українці Berlin',targetVerified:true,sendConfirmed:true,
    },NOW+3),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
  assert.equal(await db.prepare('SELECT COUNT(*) FROM chat_publications').first('COUNT(*)'),0);
});


void test('batch autopost queues multiple ready chats and reserves distinct unused materials when available',async t=>{
  const db=await localDatabase(t);
  await seedDevice(db);
  await seedAdvertisement(db,'batch-ad-a');
  await db.prepare("UPDATE library_items SET title='A material',updated_at=2 WHERE id='batch-ad-a'").run();
  await seedAdvertisement(db,'batch-ad-b');
  await db.prepare("UPDATE library_items SET title='B material',updated_at=1 WHERE id='batch-ad-b'").run();

  for(const suffix of ['a','b']){
    await seedChat(db,{id:'batch-chat-'+suffix,owner:'u',platform:'whatsapp',status:'ready',joined:10});
    await db.prepare("UPDATE chats SET name=?1,link=?2,normalized_link=?2,updated_at=?3 WHERE id=?4")
      .bind('Українці '+suffix.toUpperCase(),'https://chat.whatsapp.com/BatchAutopost'+suffix+'123',10+suffix.charCodeAt(0),'batch-chat-'+suffix).run();
  }

  const batch=await createWhatsAppAutopostBatch(db,'u',{limit:30},NOW,DATE);
  assert.equal(batch.created,2);
  assert.equal(batch.skipped,0);
  assert.equal(new Set(batch.jobs.map(job=>job.chatId)).size,2);
  assert.equal(new Set(batch.jobs.map(job=>job.advertisementId)).size,2);

  const repeated=await createWhatsAppAutopostBatch(db,'u',{limit:30},NOW+1,DATE);
  assert.equal(repeated.created,0);

  const firstTask=await claimWhatsAppAutopostJob(db,'u',NOW+2);
  assert.ok(firstTask);
  assert.ok(batch.jobs.some(job=>job.id===firstTask.jobId));
  assert.ok(batch.jobs.some(job=>job.advertisementId===firstTask.material.advertisementId));
});

void test('batch autopost skips chats without a safe material instead of failing the whole queue',async t=>{
  const db=await localDatabase(t);
  await seedDevice(db);
  await seedAdvertisement(db,'only-wa');
  await seedChat(db,{id:'batch-ok',owner:'u',platform:'whatsapp',status:'ready',joined:10});
  await seedChat(db,{id:'batch-published',owner:'u',platform:'whatsapp',status:'ready',joined:10});
  await db.prepare("UPDATE chats SET name='Українці OK',link='https://chat.whatsapp.com/BatchOk123',normalized_link='https://chat.whatsapp.com/BatchOk123' WHERE id='batch-ok'").run();
  await db.prepare("UPDATE chats SET name='Українці Published',link='https://chat.whatsapp.com/BatchPublished123',normalized_link='https://chat.whatsapp.com/BatchPublished123' WHERE id='batch-published'").run();
  await db.prepare(`INSERT INTO chat_publications
    (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at)
    VALUES ('pub','u','batch-published',?1,?2,'only-wa','manual','manual:pub',?2)`).bind(DATE,NOW).run();

  const batch=await createWhatsAppAutopostBatch(db,'u',{limit:30},NOW+1,DATE);
  assert.equal(batch.created,1);
  assert.equal(batch.jobs[0].chatId,'batch-ok');
});


void test('custom WhatsApp caption can autopost without a normal active Library advertisement',async t=>{
  const db=await localDatabase(t);
  await seedDevice(db);
  await seedChat(db,{id:'custom-caption-chat',owner:'u',platform:'whatsapp',status:'ready',joined:10});
  await db.prepare("UPDATE chats SET name='Українці Custom',link='https://chat.whatsapp.com/CustomCaption123',normalized_link='https://chat.whatsapp.com/CustomCaption123' WHERE id='custom-caption-chat'").run();
  const chat=await readChatState(db,'u','custom-caption-chat');
  const job=await createWhatsAppAutopostJob(db,'u',{
    requestKey:'request_custom_caption',chatId:chat.id,caption:'Власний текст автопоста',
  },NOW,DATE);
  assert.equal(job.status,'pending');
  const hidden=await db.prepare('SELECT kind,uk_text,archived_at FROM library_items WHERE id=?1 AND user_id=?2')
    .bind(job.advertisementId,'u').first();
  assert.equal(hidden.kind,'advertisement');
  assert.equal(hidden.uk_text,'Власний текст автопоста');
  assert.ok(hidden.archived_at);

  const task=await claimWhatsAppAutopostJob(db,'u',NOW+1);
  assert.ok(task);
  assert.equal(task.material.text,'Власний текст автопоста');
  const completed=await completeWhatsAppAutopostJob(db,'u',{
    jobId:job.id,status:'sent',observedTarget:'Українці Custom',targetVerified:true,sendConfirmed:true,
  },NOW+2);
  assert.equal(completed.status,'sent');
  assert.equal(await db.prepare("SELECT COUNT(*) FROM chat_publications WHERE chat_id='custom-caption-chat' AND source='whatsapp_autopost'").first('COUNT(*)'),1);
});

// Live report 2026-10-06: a queue started right after the runner reconnected burned eight jobs in seconds —
// each one hit a WhatsApp Web still on its loading screen, and a fail-closed autopost marks the job failed
// for good. Nothing is sent before the send control is clicked, so those stages must retry, not burn.
void test('autopost waits for a ready WhatsApp and retries the stages that happen before the send click',async()=>{
  const { readFile }=await import('node:fs/promises');
  const runner=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');
  const adapter=await readFile(new URL('../scripts/whatsapp-web-cdp.mjs',import.meta.url),'utf8');
  const handler=runner.slice(runner.indexOf('async function handleAutopostTask'),runner.indexOf('async function handleDiscoveryTask'));
  assert.match(handler,/if\(!await whatsappHomeReady\(\)\)\{/);
  assert.match(handler,/WHATSAPP_AUTOPOST_RETRY_REASONS\.has\(automated\.reason\)/);
  // The retry set must stop at the send click: a failure at or after it could double-post.
  for(const reason of ['media_attach_failed','media_preview_not_ready','media_caption_not_found','media_caption_mismatch'])
    assert.ok(runner.includes(`'${reason}'`),`${reason} must be retryable`);
  assert.doesNotMatch(runner,/WHATSAPP_AUTOPOST_RETRY_REASONS=new Set\(\[[^\]]*media_send_control_not_found/);
  assert.doesNotMatch(runner,/WHATSAPP_AUTOPOST_RETRY_REASONS=new Set\(\[[^\]]*send_not_confirmed/);
  // A bare reason could not tell a slow WhatsApp from a renamed control; the log now says which it was.
  assert.match(adapter,/readWhatsappMediaPreviewDiagnostic/);
  assert.match(adapter,/AUTOPOST_MEDIA_PREVIEW_MS = 20_000/);
});
