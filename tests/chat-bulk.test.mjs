import assert from 'node:assert/strict';
import test from 'node:test';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';
import { cleanChatName, normalizeGroupLink, parseBulkText } from '../lib/chats/bulk-input.ts';
import { addBulkChats, previewBulkChats } from '../lib/chats/bulk.ts';
import { handleBulkChats } from '../lib/chats/bulk-http.ts';
import { activitySummaryStatement } from '../lib/activity-summary.ts';

const NOW=Date.parse('2026-09-11T08:00:00Z')/1000;
const item=(link,name='')=>({link,name});
const count=async(db,table)=>(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
const command=(plan,requestId=crypto.randomUUID())=>({items:plan.items.filter(i=>i.status==='new').map(({link,name})=>({link,name})),revision:plan.revision,requestId});
async function stored(db,{id='old',owner='u',platform='telegram',link,status='ready'}) {
  await seedChat(db,{id,owner,platform,status});
  await db.prepare('UPDATE chats SET link=?1,normalized_link=?1 WHERE id=?2').bind(link,id).run();
}

void test('mixed input preserves invite case, normalizes aliases/tracking and keeps names and emoji',()=>{
  const rows=parseBulkText('1. Батьки &amp; діти &#x1F60A; https://telegram.me/Parent_Group?utm_source=x\nhttps://t.me/joinchat/AbCd,https://chat.whatsapp.com/ABcDe?mode=gi_t\nhttps://invite.viber.com/?g2=AB%2BC%3D\nhttps://m.facebook.com/groups/SchoolGroup/posts/123?fbclid=x\nне посилання');
  assert.equal(rows.length,6); assert.equal(rows[0].name,'Батьки & діти 😊');
  assert.equal(normalizeGroupLink(rows[0].link).link,'https://t.me/parent_group');
  assert.equal(normalizeGroupLink(rows[1].link).link,'https://t.me/+AbCd');
  assert.notEqual(normalizeGroupLink('https://t.me/+AbCd').link,normalizeGroupLink('https://t.me/+abcd').link);
  assert.equal(normalizeGroupLink(rows[2].link).link,'https://chat.whatsapp.com/ABcDe');
  assert.equal(normalizeGroupLink(rows[3].link).link,'https://invite.viber.com/?g2=AB%2BC%3D');
  assert.equal(normalizeGroupLink(rows[4].link).link,'https://www.facebook.com/groups/schoolgroup');
  assert.equal(normalizeGroupLink(rows[5].link),null);
  assert.equal(Array.from(cleanChatName('😊'.repeat(181))).length,180);
  assert.equal(cleanChatName(' A\u0000B &amp;amp; C '),'A B & C');
});

void test('unsupported domains, contacts, credentials and malformed URLs stay invalid',()=>{
  for(const link of ['javascript://t.me/hello','https://t.me.evil.test/hello','https://evil.test/t.me/hello','https://u:p@t.me/hello','https://t.me:123/hello','https://t.me/%ZZ','https://t.me/share?url=x','https://wa.me/12345','https://facebook.com/login','https://invite.viber.com','https://chats.viber.com/%00bad']) assert.equal(normalizeGroupLink(link),null,link);
  assert.throws(()=>parseBulkText('x'.repeat(100001)),/завеликий/);
  assert.throws(()=>parseBulkText(Array.from({length:501},(_,i)=>`https://t.me/group_${i}`).join('\n')),/500/);
});

void test('preview is read-only, detects legacy active/archive aliases and isolates the owner',async t=>{
  const db=await localDatabase(t);
  await stored(db,{link:'http://telegram.me/Parent_Group/?utm_source=old#x'});
  await stored(db,{id:'archive',link:'https://t.me/joinchat/AbCd',status:'archived'});
  await stored(db,{id:'foreign',owner:'other',link:'https://t.me/fresh_group'});
  const before=await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first();
  const plan=await previewBulkChats(db,'u',[item('https://t.me/parent_group'),item('https://t.me/+AbCd'),item('https://t.me/fresh_group'),item('https://telegram.dog/fresh_group'),item('broken')]);
  assert.deepEqual(plan.items.map(i=>i.status),['existing','archived','new','duplicate','invalid']);
  assert.deepEqual(await db.prepare("SELECT revision FROM backup_revisions WHERE user_id='u'").first(),before);
  assert.equal(await count(db,'chats'),3);assert.equal(await count(db,'activity_events'),0);
});

void test('500 chats add atomically with bounded query count and create no joining/publication metrics',async t=>{
  const db=await localDatabase(t);
  const rows=Array.from({length:500},(_,i)=>item(`https://t.me/group_${i}`,`Група ${i}`));
  const plan=await previewBulkChats(db,'u',rows);
  let statements=0;
  const measured={prepare(sql){statements++;return db.prepare(sql);},batch:db.batch.bind(db)};
  const payload=command(plan);
  const result=await addBulkChats(measured,'u',payload,NOW);
  assert.deepEqual(result,{added:500,counts:{telegram:500}});
  assert.equal(statements,5);
  assert.equal(await count(db,'chats'),500);assert.equal(await count(db,'activity_events'),1);
  const row=await db.prepare('SELECT * FROM chats LIMIT 1').first();
  assert.equal(row.workflow_status,'to_join');assert.equal(row.telegram_account_id,null);assert.equal(row.joined_at,null);
  assert.equal((await activitySummaryStatement(db,'u','2026-09-11','2026-09-11').all()).results.length,0);
  assert.deepEqual(await addBulkChats(db,'u',payload,NOW+1),result);
  assert.equal(await count(db,'chats'),500);assert.equal(await count(db,'activity_events'),1);
});

void test('concurrent identical delivery returns one saved result without duplicate chats',async t=>{
  const db=await localDatabase(t);
  const plan=await previewBulkChats(db,'u',[item('https://t.me/hello_group')]);const payload=command(plan);
  const results=await Promise.all([addBulkChats(db,'u',payload,NOW),addBulkChats(db,'u',payload,NOW)]);
  assert.deepEqual(results[0],results[1]);assert.equal(await count(db,'chats'),1);assert.equal(await count(db,'activity_events'),1);
  await assert.rejects(addBulkChats(db,'u',{...payload,items:[item('https://t.me/other_group')]},NOW),/іншого списку/);
  assert.equal(await count(db,'chats'),1);
});

void test('competing batches and changes after preview fail without a partial write',async t=>{
  const db=await localDatabase(t);const rows=[item('https://t.me/same_group')];
  const plan=await previewBulkChats(db,'u',rows);
  const results=await Promise.allSettled([addBulkChats(db,'u',command(plan),NOW),addBulkChats(db,'u',command(plan),NOW)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await count(db,'chats'),1);
  const next=await previewBulkChats(db,'u',[item('https://t.me/next_group')]);
  const raced={prepare:db.prepare.bind(db),async batch(statements){
    const result=await db.batch(statements);
    if(result[0].results[0]?.revision!==undefined) await db.prepare("UPDATE chats SET name='Concurrent edit'").run();
    return result;
  }};
  await assert.rejects(addBulkChats(raced,'u',command(next),NOW),/змінилася/);
  assert.equal(await count(db,'chats'),1);assert.equal(await count(db,'activity_events'),1);
});

void test('identical delivery committed between receipt lookup and preview returns its saved result',async t=>{
  const db=await localDatabase(t);const plan=await previewBulkChats(db,'u',[item('https://t.me/racing_group')]);
  const payload=command(plan);let inserted=false;
  const raced={prepare:db.prepare.bind(db),async batch(statements){
    if(!inserted){inserted=true;await addBulkChats(db,'u',payload,NOW);}
    return db.batch(statements);
  }};
  assert.deepEqual(await addBulkChats(raced,'u',payload,NOW),{added:1,counts:{telegram:1}});
  assert.equal(await count(db,'chats'),1);assert.equal(await count(db,'activity_events'),1);
});

void test('receipt failure rolls back every new row and permits the identical retry',async t=>{
  const db=await localDatabase(t);const plan=await previewBulkChats(db,'u',[item('https://t.me/first_group'),item('https://t.me/second_group')]);
  const payload=command(plan);
  await db.prepare("CREATE TRIGGER fail_bulk BEFORE INSERT ON activity_events WHEN NEW.event_type='chat_bulk_added' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END").run();
  await assert.rejects(addBulkChats(db,'u',payload,NOW),/injected receipt failure/);
  assert.equal(await count(db,'chats'),0);assert.equal(await count(db,'activity_events'),0);
  await db.prepare('DROP TRIGGER fail_bulk').run();
  assert.equal((await addBulkChats(db,'u',payload,NOW)).added,2);
});

void test('direct add revalidates duplicates and cannot overwrite an archived chat or create invalid rows',async t=>{
  const db=await localDatabase(t);await stored(db,{status:'archived',link:'https://telegram.me/Old_Group'});
  const before=await db.prepare("SELECT * FROM chats WHERE id='old'").first();
  const plan=await previewBulkChats(db,'u',[item('https://t.me/new_group')]);
  for(const rows of [[item('https://t.me/old_group','Overwrite')],[item('https://evil.test/')],[item('https://t.me/new_group'),item('https://t.me/new_group')]]) {
    await assert.rejects(addBulkChats(db,'u',{...command(plan),items:rows},NOW),/повтори|нерозпізнані/);
  }
  assert.deepEqual(await db.prepare("SELECT * FROM chats WHERE id='old'").first(),before);
  assert.equal(await count(db,'chats'),1);
});

void test('HTTP validates origin, media type, JSON, size and action before accessing D1',async()=>{
  const db={prepare(){assert.fail('Validation must not access D1');}};
  for(const [body,headers,status] of [
    ['{}',{'Content-Type':'application/json'},403],
    ['{}',{Origin:'http://localhost','Content-Type':'text/plain'},415],
    ['null',{Origin:'http://localhost','Content-Type':'application/json'},400],
    ['{',{Origin:'http://localhost','Content-Type':'application/json'},400],
    ['x'.repeat(256001),{Origin:'http://localhost','Content-Type':'application/json'},413],
    ['{"action":"delete"}',{Origin:'http://localhost','Content-Type':'application/json'},400],
  ]) {
    const result=await handleBulkChats(db,'u',new Request('http://localhost/api/chats/bulk',{method:'POST',body,headers}),NOW);
    assert.equal(result.status,status);assert.equal(result.headers.get('cache-control'),'no-store');
  }
});

void test('a 10k-chat preview uses two statements, remains bounded and does not write',async t=>{
  const db=await localDatabase(t);
  const rows=Array.from({length:10000},(_,i)=>({id:`seed-${i}`,link:`https://t.me/known_${i}`}));
  await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at)
    SELECT json_extract(value,'$.id'),'u','telegram','Existing',json_extract(value,'$.link'),json_extract(value,'$.link'),'to_join',1,1 FROM json_each(?1)`)
    .bind(JSON.stringify(rows)).run();
  let statements=0;const measured={prepare(sql){statements++;return db.prepare(sql);},batch:db.batch.bind(db)};
  const started=performance.now();const plan=await previewBulkChats(measured,'u',[item('https://telegram.me/KNOWN_9999'),item('https://t.me/fresh_group')]);
  t.diagnostic(`10k existing chats: preview ${Math.round(performance.now()-started)}ms, ${statements} SQL statements`);
  assert.equal(statements,2);assert.deepEqual(plan.items.map(i=>i.status),['existing','new']);assert.equal(await count(db,'activity_events'),0);
});
