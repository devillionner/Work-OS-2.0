import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MessengerAutomationError,
  claimViberSafeNoteJob,
  completeViberSafeNoteJob,
  createViberSafeNoteJob,
  readLatestViberSafeNoteJob,
  readViberSafeNoteJob,
} from '../lib/messenger-automation.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-24T12:00:00Z')/1000;

async function seedAdvertisement(db,{id='ad',platforms=['viber'],uk='Тест Viber',ru='Тест Viber RU'}={}){
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,collection,version,title,uk_text,ru_text,tags_json,platforms_json,created_at,updated_at)
    VALUES (?1,'u','advertisement','advertisement',3,'Safe ad',?2,?3,'[]',?4,1,1)`)
    .bind(id,uk,ru,JSON.stringify(platforms)).run();
}
async function seedDevice(db,id='device'){
  await db.prepare(`INSERT INTO chat_discovery_executor_devices(id,user_id,name,token_hash,created_at)
    VALUES (?1,'u','Device',?2,1)`).bind(id,'hash-'+id).run();
}

void test('Viber safe note job is idempotent and never creates publication accounting facts',async t=>{
  const db=await localDatabase(t);await seedAdvertisement(db);await seedDevice(db);
  const first=await createViberSafeNoteJob(db,'u',{requestKey:'request_12345',advertisementId:'ad',language:'uk'},NOW);
  const retry=await createViberSafeNoteJob(db,'u',{requestKey:'request_12345',advertisementId:'ad',language:'uk'},NOW+1);
  assert.equal(retry.id,first.id);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM messenger_automation_jobs').first('COUNT(*)'),1);

  const task=await claimViberSafeNoteJob(db,'u','device',NOW+2);
  assert.equal(task?.kind,'viber_safe_note');
  assert.deepEqual(task?.target,{kind:'my_notes',expectedLabel:'Мої нотатки'});
  assert.equal(task?.safety.createsPublication,false);
  assert.equal(task?.material.text,'Тест Viber');

  const completed=await completeViberSafeNoteJob(db,'u','device',{
    jobId:first.id,status:'sent',observedTarget:'my_notes',targetVerified:true,sendConfirmed:true,
  },NOW+3);
  assert.equal(completed.status,'sent');
  assert.equal(completed.createsPublication,false);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM chat_publications").first('COUNT(*)'),0);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM activity_events WHERE event_type='publication'").first('COUNT(*)'),0);
  assert.equal((await readLatestViberSafeNoteJob(db,'u'))?.status,'sent');
});

void test('Viber safe note completion fails closed on wrong or unconfirmed target',async t=>{
  const db=await localDatabase(t);await seedAdvertisement(db);await seedDevice(db);
  const job=await createViberSafeNoteJob(db,'u',{requestKey:'request_67890',advertisementId:'ad',language:'ru'},NOW);
  await claimViberSafeNoteJob(db,'u','device',NOW+1);
  const completed=await completeViberSafeNoteJob(db,'u','device',{
    jobId:job.id,status:'sent',observedTarget:'other',targetVerified:false,sendConfirmed:true,errorCode:'wrong_target',
  },NOW+2);
  assert.equal(completed.status,'failed');
  assert.equal(completed.result.errorCode,'wrong_target');
  assert.equal(await db.prepare("SELECT COUNT(*) FROM chat_publications").first('COUNT(*)'),0);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM activity_events WHERE event_type='publication'").first('COUNT(*)'),0);
});

void test('Viber safe note completion cannot commit after its executor lease expires',async t=>{
  const db=await localDatabase(t);await seedAdvertisement(db);await seedDevice(db);
  const job=await createViberSafeNoteJob(db,'u',{requestKey:'request_expired_lease',advertisementId:'ad',language:'uk'},NOW);
  const task=await claimViberSafeNoteJob(db,'u','device',NOW+1);
  assert.ok(task);
  await assert.rejects(
    completeViberSafeNoteJob(db,'u','device',{
      jobId:job.id,status:'sent',observedTarget:'my_notes',targetVerified:true,sendConfirmed:true,
    },task.leaseExpiresAt),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
  assert.equal((await readLatestViberSafeNoteJob(db,'u'))?.status,'claimed');
  assert.equal(await db.prepare("SELECT COUNT(*) FROM chat_publications").first('COUNT(*)'),0);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM activity_events WHERE event_type='publication'").first('COUNT(*)'),0);
});

void test('Viber safe note accepts only active Viber material with requested language and one active job',async t=>{
  const db=await localDatabase(t);await seedAdvertisement(db,{id:'wa',platforms:['whatsapp']});await seedAdvertisement(db,{id:'viber'});
  await assert.rejects(
    createViberSafeNoteJob(db,'u',{requestKey:'request_wrong_platform',advertisementId:'wa',language:'uk'},NOW),
    error=>error instanceof MessengerAutomationError&&/не дозволене для Viber/.test(error.message),
  );
  await createViberSafeNoteJob(db,'u',{requestKey:'request_active_one',advertisementId:'viber',language:'uk'},NOW+1);
  await assert.rejects(
    createViberSafeNoteJob(db,'u',{requestKey:'request_active_two',advertisementId:'viber',language:'uk'},NOW+2),
    error=>error instanceof MessengerAutomationError&&error.status===409,
  );
});

void test('Viber safe note targeted read is owner scoped and returns only the requested job',async t=>{
  const db=await localDatabase(t);await seedAdvertisement(db);await seedDevice(db);
  const job=await createViberSafeNoteJob(db,'u',{requestKey:'request_targeted_read',advertisementId:'ad',language:'uk'},NOW);
  assert.equal((await readViberSafeNoteJob(db,'u',job.id))?.id,job.id);
  assert.equal(await readViberSafeNoteJob(db,'other',job.id),null);
  assert.equal(await readViberSafeNoteJob(db,'u','missing'),null);
});
