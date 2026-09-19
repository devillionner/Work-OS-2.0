import assert from 'node:assert/strict';
import test from 'node:test';
import { readChatAnalytics } from '../lib/chats/analytics.ts';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';

void test('chat analytics attributes lead outcomes through source chat and isolates period/owner', async (t) => {
  const db=await localDatabase(t);
  await seedChat(db,{id:'chat-a',owner:'u',platform:'whatsapp',status:'ready'});
  await seedChat(db,{id:'chat-b',owner:'u',platform:'whatsapp',status:'ready'});
  await seedChat(db,{id:'chat-other',owner:'other',platform:'whatsapp',status:'ready'});
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,source_chat_id,status,created_at,updated_at)
    VALUES ('lead-a','u','Lead A','whatsapp','chat-a','booked',1,1),
           ('lead-b','u','Lead B','whatsapp','chat-b','response',1,1),
           ('lead-other','other','Private','whatsapp','chat-other','response',1,1)`).run();
  await seedEvent(db,{id:'pub-a',owner:'u',type:'publication',date:'2026-09-18',chat:'chat-a',platform:'whatsapp'});
  await seedEvent(db,{id:'response-a',owner:'u',type:'lead_created',date:'2026-09-18',lead:'lead-a',platform:'whatsapp'});
  await seedEvent(db,{id:'book-a',owner:'u',type:'lesson_booked',date:'2026-09-18',lead:'lead-a',platform:'whatsapp'});
  await seedEvent(db,{id:'done-a',owner:'u',type:'lesson_completed',date:'2026-09-18',lead:'lead-a',platform:'whatsapp'});
  await seedEvent(db,{id:'old-a',owner:'u',type:'publication',date:'2026-08-01',chat:'chat-a',platform:'whatsapp'});
  await seedEvent(db,{id:'other-chat',owner:'u',type:'lead_created',date:'2026-09-18',lead:'lead-b',platform:'whatsapp'});
  await seedEvent(db,{id:'foreign',owner:'other',type:'lead_created',date:'2026-09-18',lead:'lead-other',platform:'whatsapp'});

  const snapshot=await readChatAnalytics(db,{userId:'u',chatId:'chat-a',period:'30',to:'2026-09-18'});
  assert.deepEqual(snapshot.summary,{
    publications:1,responses:1,bookings:1,completed:1,
    responseRate:100,bookingRate:100,completionRate:100,
  });
  assert.equal(snapshot.from,'2026-08-20');
  assert.deepEqual(new Set(snapshot.events.map(event=>event.id)),new Set(['pub-a','response-a','book-a','done-a']));
  assert.equal(snapshot.events.find(event=>event.id==='response-a')?.leadName,'Lead A');

  const all=await readChatAnalytics(db,{userId:'u',chatId:'chat-a',period:'all',to:'2026-09-18'});
  assert.equal(all.summary.publications,2);
  assert.equal(all.from,null);
});

void test('chat analytics UI exposes periods, conversion metrics and linked event drill-down', async () => {
  const { readFile }=await import('node:fs/promises');
  const source=await readFile(new URL('../components/chat-history-dialog.tsx',import.meta.url),'utf8');
  assert.match(source,/Результат чату/);
  assert.match(source,/7 днів/);
  assert.match(source,/30 днів/);
  assert.match(source,/Весь час/);
  assert.match(source,/Відгук \/ публікація/);
  assert.match(source,/Запис \/ відгук/);
  assert.match(source,/Проведено \/ запис/);
  assert.match(source,/filterAnalyticsEvents/);
});
