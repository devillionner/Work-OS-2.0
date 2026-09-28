import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeUnicodeSearchText, unicodeSearchIncludes, unicodeSearchMatchesAny } from '../lib/unicode-search.ts';

void test('shared Unicode search folds Ukrainian and Russian case correctly',()=>{
  assert.equal(normalizeUnicodeSearchText('ДНІП'),'дніп');
  assert.equal(unicodeSearchIncludes('Мами у Дніпрі [Чат]','дніп'),true);
  assert.equal(unicodeSearchIncludes('Продам-Отдам-Куплю Филлинген','филЛИНГЕН'),true);
  assert.equal(unicodeSearchMatchesAny(['Нотатка','Українці в Örebro'],'українці'),true);
  assert.equal(unicodeSearchMatchesAny(['Київ','Львів'],'дніп'),false);
});

void test('library search filters Unicode in application code instead of SQLite lower()',async()=>{
  const route=await readFile(new URL('../app/api/library/route.ts',import.meta.url),'utf8');
  assert.match(route,/normalizeUnicodeSearchText\(search\)/);
  assert.match(route,/unicodeSearchMatchesAny\(\[row\.title,row\.uk_text,row\.ru_text,row\.notes,row\.tags_json\]/);
  assert.match(route,/subjectTerms\.some\(term=>unicodeSearchMatchesAny/);
  assert.match(route,/\.filter\([\s\S]*?\.slice\(0,200\)/);
  assert.doesNotMatch(route,/lower\(title\) LIKE/);
  assert.doesNotMatch(route,/lower\(uk_text\) LIKE/);
  assert.doesNotMatch(route,/lower\(ru_text\) LIKE/);
});
