import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chatMatchesSearch, normalizeChatSearchText } from '../lib/chats/search.ts';

void test('chat search is Unicode case-insensitive for Ukrainian and Cyrillic names',()=>{
  assert.equal(chatMatchesSearch('Мами у Дніпрі [Чат]','invite.viber.com/example','дніп'),true);
  assert.equal(chatMatchesSearch('Дніпро в Німеччині','invite.viber.com/example','ДНІП'),true);
  assert.equal(chatMatchesSearch('УКРАЇНЦІ В ÖREBRO','https://example.test','українці'),true);
  assert.equal(chatMatchesSearch('Продам-Отдам-Куплю Филлинген','https://example.test','филЛИНГЕН'),true);
  assert.equal(chatMatchesSearch('Київ','https://example.test','дніп'),false);
});

void test('chat search normalizes Unicode and searches links case-insensitively',()=>{
  assert.equal(normalizeChatSearchText('  ДНІП  '),'  дніп  ');
  assert.equal(chatMatchesSearch('Інший чат','https://chat.whatsapp.com/AbCDef123','abcdef123'),true);
  assert.equal(chatMatchesSearch('Інший чат','HTTPS://INVITE.VIBER.COM/SomeCode','somecode'),true);
});

void test('chat API filters the full queue before pagination and no longer relies on SQLite lower()',async()=>{
  const route=await readFile(new URL('../app/api/chats/route.ts',import.meta.url),'utf8');
  assert.match(route,/normalizeChatSearchText\(search\)/);
  assert.match(route,/searchIndex\.results\.filter\(row=>chatMatchesSearch/);
  assert.match(route,/searchTotal=matched\.length/);
  assert.match(route,/matched\.slice\(offset,offset\+50\)/);
  assert.doesNotMatch(route,/lower\(c\.name\) LIKE/);
  assert.doesNotMatch(route,/lower\(c\.link\) LIKE/);
});
