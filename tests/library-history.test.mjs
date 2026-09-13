import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCollection, libraryKind, libraryVersionStatement } from '../lib/library.ts';
import { rankLeadScripts } from '../lib/leads/domain/script-match.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;

async function seedItem(db,{id='item',owner='u',collection='personal_script',version=1}={}){
  const kind=libraryKind(collection);
  await db.prepare(`INSERT INTO library_items
    (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,'Початковий','Текст','','','[]','[]',1,1)`)
    .bind(id,owner,kind,collection,version).run();
  await db.prepare(`DELETE FROM library_item_versions WHERE item_id=?1`).bind(id).run();
}

void test('legacy script defaults remain personal while explicit collections map to compatible kinds',()=>{
  assert.equal(defaultCollection('advertisement'),'advertisement');
  assert.equal(defaultCollection('script'),'personal_script');
  assert.equal(libraryKind('advertisement'),'advertisement');
  for(const collection of ['official_script','personal_script','knowledge']) assert.equal(libraryKind(collection),'script');
});

void test('library snapshots are monotonic and stale same-second writes cannot overwrite a newer version',async t=>{
  const db=await localDatabase(t);await seedItem(db);
  const first=await db.batch([
    db.prepare(`UPDATE library_items SET title='v2',updated_at=?1,version=version+1 WHERE id='item' AND user_id='u' AND version=1`).bind(NOW),
    libraryVersionStatement(db,{userId:'u',itemId:'item',action:'update',expectedVersion:2,savedAt:NOW}),
  ]);
  assert.equal(first[0].meta.changes>0,true);
  const stale=await db.batch([
    db.prepare(`UPDATE library_items SET title='stale',updated_at=?1,version=version+1 WHERE id='item' AND user_id='u' AND version=1`).bind(NOW),
    libraryVersionStatement(db,{userId:'u',itemId:'item',action:'update',expectedVersion:2,savedAt:NOW}),
  ]);
  assert.equal(stale[0].meta.changes,0);
  const item=await db.prepare(`SELECT title,version FROM library_items WHERE id='item'`).first();
  assert.deepEqual(item,{title:'v2',version:2});
  const versions=await db.prepare(`SELECT version_number,action,title FROM library_item_versions WHERE item_id='item' ORDER BY version_number`).all();
  assert.deepEqual(versions.results,[{version_number:2,action:'update',title:'v2'}]);
});

void test('archive and restore each append a full immutable snapshot',async t=>{
  const db=await localDatabase(t);await seedItem(db,{collection:'official_script'});
  for(const [action,expected,nextArchive,at] of [['archive',1,NOW,NOW],['restore',2,null,NOW+1]]){
    const next=expected+1;
    const results=await db.batch([
      db.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?2,version=version+1 WHERE id='item' AND user_id='u' AND version=?3`).bind(nextArchive,at,expected),
      libraryVersionStatement(db,{userId:'u',itemId:'item',action,expectedVersion:next,savedAt:at}),
    ]);
    assert.equal(results[0].meta.changes>0,true);
  }
  const snapshots=await db.prepare(`SELECT version_number,action,collection,archived_at FROM library_item_versions WHERE item_id='item' ORDER BY version_number`).all();
  assert.deepEqual(snapshots.results,[
    {version_number:2,action:'archive',collection:'official_script',archived_at:NOW},
    {version_number:3,action:'restore',collection:'official_script',archived_at:null},
  ]);
});

void test('library history remains owner isolated',async t=>{
  const db=await localDatabase(t);await seedItem(db,{id:'mine',owner:'u'});await seedItem(db,{id:'foreign',owner:'other'});
  await db.batch([
    db.prepare(`UPDATE library_items SET title='Mine v2',version=version+1 WHERE id='mine' AND user_id='u' AND version=1`),
    libraryVersionStatement(db,{userId:'u',itemId:'mine',action:'update',expectedVersion:2,savedAt:NOW}),
  ]);
  await db.batch([
    db.prepare(`UPDATE library_items SET title='Foreign v2',version=version+1 WHERE id='foreign' AND user_id='other' AND version=1`),
    libraryVersionStatement(db,{userId:'other',itemId:'foreign',action:'update',expectedVersion:2,savedAt:NOW}),
  ]);
  const mine=await db.prepare(`SELECT item_id FROM library_item_versions WHERE user_id='u'`).all();
  assert.deepEqual(mine.results,[{item_id:'mine'}]);
});

void test('lead script ranking uses explicit official/personal scope and remains compatible with legacy tags',()=>{
  const base={ukText:'x',ruText:'',notes:'',tags:[],platforms:['telegram'],updatedAt:1};
  const ranked=rankLeadScripts([
    {...base,id:'official',title:'Official',collection:'official_script'},
    {...base,id:'personal',title:'Personal',collection:'personal_script'},
    {...base,id:'legacy',title:'Legacy',tags:['personal']},
  ],{platform:'telegram',subject:'',funnelStage:'',qualification:null},10);
  const byId=new Map(ranked.map(item=>[item.id,item.audience]));
  assert.equal(byId.get('official'),'work');
  assert.equal(byId.get('personal'),'personal');
  assert.equal(byId.get('legacy'),'personal');
});
