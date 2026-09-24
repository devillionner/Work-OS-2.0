import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnalyticsMetricEvents } from '../lib/analytics-events.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('analytics metric events are owner/date scoped and ignore cancelled facts', async t=>{
  const db=await localDatabase(t);
  await db.prepare("INSERT INTO leads(id,user_id,name,platform,status,created_at,updated_at) VALUES ('l1','u','Lead','telegram','new',1,1)").run();
  await db.prepare("INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,created_at,updated_at) VALUES ('c1','u','telegram','Chat','https://t.me/x','https://t.me/x','ready',1,1)").run();
  await db.prepare("UPDATE leads SET source_chat_id='c1' WHERE id='l1'").run();
  const rows=[
    ['p','u','publication','telegram','c1',null,null,10,'2026-09-20',null],
    ['r','u','lead_created','telegram',null,'l1',null,11,'2026-09-20',null],
    ['b','u','lesson_booked','telegram',null,'l1',null,12,'2026-09-20',null],
    ['q','u','curator_booking_pending','telegram',null,'l1',null,13,'2026-09-20',null],
    ['x','u','lead_created','telegram',null,'l1',null,14,'2026-09-20',99],
    ['o','other','lead_created','telegram',null,null,null,15,'2026-09-20',null],
  ];
  for(const row of rows) await db.prepare("INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,cancelled_at) VALUES (?,?,?,?,?,?,?,?,?,'{}',?,?)")
    .bind(...row.slice(0,9),'test:'+row[0],row[9]).run();
  const responses=await readAnalyticsMetricEvents(db,{userId:'u',metric:'responses',from:'2026-09-20',to:'2026-09-20'});
  assert.equal(responses.total,1);
  assert.equal(responses.events[0].chatName,'Chat');
  assert.equal(responses.events[0].leadName,'Lead');
  const bookings=await readAnalyticsMetricEvents(db,{userId:'u',metric:'bookings',from:'2026-09-20',to:'2026-09-20'});
  assert.equal(bookings.total,2);
  assert.deepEqual(new Set(bookings.events.map(event=>event.eventType)),new Set(['lesson_booked','curator_booking_pending']));
});

void test('analytics metric UI exposes definitions, formulas, period and event drill-down', async()=>{
  const {readFile}=await import('node:fs/promises');
  const workspace=await readFile(new URL('../components/analytics-workspace.tsx',import.meta.url),'utf8');
  const dialog=await readFile(new URL('../components/analytics-metric-dialog.tsx',import.meta.url),'utf8');
  assert.equal((workspace.match(/Що входить · Події/g)||[]).length,1);
  for(const metric of ['publications','responses','bookings','completed']) assert.match(workspace,new RegExp('metric="'+metric+'"'));
  assert.match(dialog,/Що рахуємо/);
  assert.match(dialog,/Формула/);
  assert.match(dialog,/Період/);
  assert.match(dialog,/Показано/);
});
