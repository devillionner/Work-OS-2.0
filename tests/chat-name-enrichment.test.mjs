import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { confirmResolvedChatName, enrichImportedChatNames, scanChatNames } from '../lib/chats/name-enrichment.ts';
import { localDatabase } from './helpers/local-d1.mjs';

async function insertChat(db, { id, owner='u', platform, name, link }) {
  await db.prepare(`INSERT INTO chats
    (id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?5,'to_join',0,1,1)`)
    .bind(id,owner,platform,name,link).run();
}

void test('name scan updates generated placeholders, preserves manual names and isolates failures/owner', async (t) => {
  const db = await localDatabase(t);
  await insertChat(db,{id:'a',platform:'telegram',name:'Telegram · school_parents',link:'https://t.me/school_parents'});
  await insertChat(db,{id:'b',platform:'whatsapp',name:'Ручна назва',link:'https://chat.whatsapp.com/AbCdEf'});
  await insertChat(db,{id:'c',platform:'viber',name:'Viber · запрошення',link:'https://invite.viber.com/?g=AbCd'});
  await insertChat(db,{id:'z',owner:'other',platform:'telegram',name:'Telegram · private',link:'https://t.me/private_group'});

  const fetcher=async (url) => {
    if(url.includes('t.me/')) return new Response('<meta property="og:title" content="Батьки школи">',{headers:{'content-type':'text/html'}});
    if(url.includes('whatsapp.com')) return new Response('<meta property="og:title" content="Parents Berlin">',{headers:{'content-type':'text/html'}});
    return new Response('unavailable',{status:503,headers:{'content-type':'text/html'}});
  };
  const result=await scanChatNames(db,'u',{limit:12},100,fetcher);
  assert.deepEqual(result.items.map(item=>[item.id,item.status]),[['a','updated'],['b','confirm'],['c','error']]);
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='a'").first()).name,'Батьки школи');
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='b'").first()).name,'Ручна назва');
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='z'").first()).name,'Telegram · private');
  assert.equal(result.counts.telegram.updated,1);
  assert.equal(result.counts.whatsapp.confirm,1);
  assert.equal(result.counts.viber.error,1);

  const conflict=result.items.find(item=>item.id==='b');
  const confirmed=await confirmResolvedChatName(db,'u',{id:'b',expectedUpdatedAt:conflict.updatedAt,name:conflict.suggestedName},120);
  assert.equal(confirmed.name,'Parents Berlin');
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='b'").first()).name,'Parents Berlin');
});

void test('paged scan exposes a stable cursor instead of one unbounded request', async (t) => {
  const db = await localDatabase(t);
  for(const id of ['a','b','c']) await insertChat(db,{id,platform:'telegram',name:`Telegram · ${id}name`,link:`https://t.me/${id}name`});
  const fetcher=async url=>new Response(`<meta property="og:title" content="${url.split('/').pop()} real">`,{headers:{'content-type':'text/html'}});
  const first=await scanChatNames(db,'u',{limit:2},100,fetcher);
  assert.equal(first.items.length,2);
  assert.equal(first.nextCursor,'b');
  const second=await scanChatNames(db,'u',{cursor:first.nextCursor,limit:2},101,fetcher);
  assert.equal(second.items.length,1);
  assert.equal(second.nextCursor,null);
});


void test('successful bulk imports can enrich their new supported chat links without touching foreign rows', async (t) => {
  const db = await localDatabase(t);
  await insertChat(db,{id:'new-a',platform:'telegram',name:'Telegram · auto_group',link:'https://t.me/auto_group'});
  await insertChat(db,{id:'foreign',owner:'other',platform:'telegram',name:'Telegram · foreign_group',link:'https://t.me/foreign_group'});
  const fetcher=async url=>new Response(`<meta property="og:title" content="${url.includes('auto_group')?'Auto Parents':'Foreign'}">`,{headers:{'content-type':'text/html'}});
  const summary=await enrichImportedChatNames(db,'u',['https://t.me/auto_group','https://t.me/foreign_group','https://www.facebook.com/groups/not-supported'],200,fetcher);
  assert.deepEqual(summary,{checked:1,updated:1,confirm:0,error:0,truncated:false});
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='new-a'").first()).name,'Auto Parents');
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='foreign'").first()).name,'Telegram · foreign_group');
});

void test('bulk route schedules name enrichment only after a successful add response', async () => {
  const source=await readFile(new URL('../app/api/chats/bulk/route.ts',import.meta.url),'utf8');
  assert.match(source,/import \{ env, waitUntil \} from 'cloudflare:workers'/);
  assert.match(source,/response\.ok/);
  assert.match(source,/body\.action==='add'/);
  assert.match(source,/waitUntil\(enrichImportedChatNames/);
});


void test('global name scan includes Facebook chats and safely updates generated placeholders', async (t) => {
  const db = await localDatabase(t);
  await insertChat(db,{id:'fb-a',platform:'facebook',name:'Facebook · parents.kyiv',link:'https://www.facebook.com/groups/parents.kyiv'});
  const fetcher=async ()=>new Response('<meta property="og:title" content="Батьки Києва | Facebook">',{headers:{'content-type':'text/html'}});
  const result=await scanChatNames(db,'u',{limit:12},300,fetcher);
  assert.deepEqual(result.items.map(item=>[item.id,item.status]),[['fb-a','updated']]);
  assert.equal(result.counts.facebook.updated,1);
  assert.equal((await db.prepare("SELECT name FROM chats WHERE id='fb-a'").first()).name,'Батьки Києва');
});
