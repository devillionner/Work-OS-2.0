import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { joinedTodayStatement } from '../lib/chats/daily-links.ts';
import { localDatabase, seedChat, seedEvent } from './helpers/local-d1.mjs';

void test('Viber joined-today data excludes archived, failed and returned-to-join chats', async (t) => {
  const db=await localDatabase(t);
  const date='2026-09-24';

  const ready=await seedChat(db,{id:'viber-ready',owner:'u',platform:'viber',status:'ready',joined:100});
  const waiting=await seedChat(db,{id:'viber-waiting',owner:'u',platform:'viber',status:'waiting',joined:101});
  const archived=await seedChat(db,{id:'viber-archived',owner:'u',platform:'viber',status:'archived',joined:102});
  const failed=await seedChat(db,{id:'viber-failed',owner:'u',platform:'viber',status:'failed',joined:103});
  const returned=await seedChat(db,{id:'viber-returned',owner:'u',platform:'viber',status:'to_join',joined:104});

  for(const [id,chat,at] of [
    ['event-ready',ready,200],['event-waiting',waiting,201],['event-archived',archived,202],
    ['event-failed',failed,203],['event-returned',returned,204],
  ]) await seedEvent(db,{id,owner:'u',type:'chat_joined',date,at,platform:'viber',chat:chat.id});

  const rows=await joinedTodayStatement(db,{userId:'u',platform:'viber',date,accountId:null}).all();
  assert.deepEqual(rows.results.map(row=>row.id),['viber-ready','viber-waiting']);
});

void test('Viber workspace exposes a compact expandable joined-today panel in the queue header area', async () => {
  const [workspace,css]=await Promise.all([
    readFile(new URL('../components/platform-workspace.tsx',import.meta.url),'utf8'),
    readFile(new URL('../app/globals.css',import.meta.url),'utf8'),
  ]);
  assert.match(workspace,/joinedTodayOpen/);
  assert.match(workspace,/Приєднані сьогодні/);
  assert.match(workspace,/Актуальні Viber-чати/);
  assert.match(workspace,/aria-expanded=\{joinedTodayOpen\}/);
  assert.match(workspace,/openNativeChat\('viber',item\.link\)/);
  assert.match(workspace,/data\.joinedToday\.length/);
  assert.match(css,/\.joined-today-panel/);
  assert.match(css,/\.joined-today-list \{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(230px,1fr\)\)/s);
  assert.match(css,/\.joined-today-list \{ grid-template-columns:1fr;/);
});
