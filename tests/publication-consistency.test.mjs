import assert from 'node:assert/strict';
import test from 'node:test';
import { activitySummaryStatement, activityTotals } from '../lib/activity-summary.ts';
import { readAnalyticsMetricEvents } from '../lib/analytics-events.ts';
import { readPublicationAdvertisementSelection } from '../lib/chats/advertisement-selection.ts';
import { recordManualPublication, undoManualPublication } from '../lib/chats/publication.ts';
import { readChatState } from '../lib/chats/state.ts';
import { localDatabase, seedChat } from './helpers/local-d1.mjs';

const DATE='2026-09-10';
const NOW=Date.parse('2026-09-10T12:00:00Z')/1000;

async function publicationCounts(db){
  const publicationCount=Number(await db.prepare(`SELECT COUNT(*) FROM chat_publications WHERE user_id='u' AND chat_id='consistency-chat' AND published_on=?1`).bind(DATE).first('COUNT(*)')||0);
  const activeEventCount=Number(await db.prepare(`SELECT COUNT(*) FROM activity_events WHERE user_id='u' AND chat_id='consistency-chat' AND event_type='publication' AND event_date=?1 AND cancelled_at IS NULL`).bind(DATE).first('COUNT(*)')||0);
  const totalEventCount=Number(await db.prepare(`SELECT COUNT(*) FROM activity_events WHERE user_id='u' AND chat_id='consistency-chat' AND event_type='publication' AND event_date=?1`).bind(DATE).first('COUNT(*)')||0);
  return {publicationCount,activeEventCount,totalEventCount};
}

async function publicationReadModels(db){
  const summary=await activitySummaryStatement(db,'u',DATE,DATE).all();
  const totals=activityTotals(summary.results);
  const analytics=await readAnalyticsMetricEvents(db,{userId:'u',metric:'publications',from:DATE,to:DATE});
  const library=await readPublicationAdvertisementSelection(db,{userId:'u',chatId:'consistency-chat',date:DATE});
  return {
    todayAndReports:totals.publications,
    analytics:analytics.total,
    usedToday:library?.items.find((item)=>item.id==='consistency-ad')?.usedToday,
  };
}

void test('publication accounting stays singular across retry, archive and Undo read models',async(t)=>{
  const db=await localDatabase(t);
  await seedChat(db,{id:'consistency-chat',owner:'u',platform:'whatsapp',status:'ready'});
  await db.prepare(`INSERT INTO library_items(id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at)
    VALUES ('consistency-ad','u','advertisement','advertisement',1,'Оголошення','Текст','','','[]','["whatsapp"]',1,1)`).run();

  const initial=await readChatState(db,'u','consistency-chat');
  const published=await recordManualPublication(db,{
    userId:'u',chat:initial,accountId:null,advertisementId:'consistency-ad',language:'uk',
    now:NOW,date:DATE,stateToken:initial.state_token,
  });
  assert.equal(published.ok,true);
  assert.deepEqual(await publicationCounts(db),{publicationCount:1,activeEventCount:1,totalEventCount:1});
  assert.deepEqual(await publicationReadModels(db),{todayAndReports:1,analytics:1,usedToday:true});
  const firstRevision=Number(await db.prepare(`SELECT revision FROM activity_day_revisions WHERE user_id='u' AND event_date=?1`).bind(DATE).first('revision')||0);
  assert.ok(firstRevision>0);

  const staleRetry=await recordManualPublication(db,{
    userId:'u',chat:initial,accountId:null,advertisementId:'consistency-ad',language:'uk',
    now:NOW+1,date:DATE,stateToken:initial.state_token,
  });
  assert.equal(staleRetry.ok,false);
  const current=await readChatState(db,'u','consistency-chat');
  const canonicalRetry=await recordManualPublication(db,{
    userId:'u',chat:current,accountId:null,advertisementId:'consistency-ad',language:'uk',
    now:NOW+1,date:DATE,stateToken:current.state_token,
  });
  assert.equal(canonicalRetry.ok,false);
  assert.deepEqual(await publicationCounts(db),{publicationCount:1,activeEventCount:1,totalEventCount:1});
  assert.deepEqual(await publicationReadModels(db),{todayAndReports:1,analytics:1,usedToday:true});

  await db.prepare(`UPDATE chats SET workflow_status='archived',archived_at=?1,updated_at=?1 WHERE id='consistency-chat' AND user_id='u'`).bind(NOW+2).run();
  assert.deepEqual(await publicationCounts(db),{publicationCount:1,activeEventCount:1,totalEventCount:1});
  const archivedSummary=await activitySummaryStatement(db,'u',DATE,DATE).all();
  assert.equal(activityTotals(archivedSummary.results).publications,1);
  assert.equal((await readAnalyticsMetricEvents(db,{userId:'u',metric:'publications',from:DATE,to:DATE})).total,1);

  await db.prepare(`UPDATE chats SET workflow_status='ready',archived_at=NULL,updated_at=?1 WHERE id='consistency-chat' AND user_id='u'`).bind(NOW+3).run();
  const restored=await readChatState(db,'u','consistency-chat');
  const undone=await undoManualPublication(db,{userId:'u',chat:restored,now:NOW+4,date:DATE});
  assert.equal(undone.ok,true);
  assert.deepEqual(await publicationCounts(db),{publicationCount:0,activeEventCount:0,totalEventCount:1});
  assert.deepEqual(await publicationReadModels(db),{todayAndReports:0,analytics:0,usedToday:false});
  const cancelledAt=Number(await db.prepare(`SELECT cancelled_at FROM activity_events WHERE user_id='u' AND chat_id='consistency-chat' AND event_type='publication' AND event_date=?1`).bind(DATE).first('cancelled_at')||0);
  assert.equal(cancelledAt,NOW+4);
  const secondRevision=Number(await db.prepare(`SELECT revision FROM activity_day_revisions WHERE user_id='u' AND event_date=?1`).bind(DATE).first('revision')||0);
  assert.ok(secondRevision>firstRevision);
});
