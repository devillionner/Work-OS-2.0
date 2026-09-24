import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isD1DailyRowReadLimit } from '../lib/d1-errors.ts';

void test('D1 free-tier daily row-read limit is recognized through direct and nested errors',()=>{
  assert.equal(isD1DailyRowReadLimit(new Error("exceeded D1's free tier daily row read limit")),true);
  const wrapped=new Error('dashboard failed',{cause:new Error("D1_ERROR: account exceeded D1's free tier daily row read limit")});
  assert.equal(isD1DailyRowReadLimit(wrapped),true);
  assert.equal(isD1DailyRowReadLimit(new Error('network timeout')),false);
});

void test('root page renders a dedicated quota recovery surface without retry controls',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/try \{[\s\S]*return await renderHome\(\)/);
  assert.match(page,/isD1DailyRowReadLimit\(error\)/);
  assert.match(page,/function D1QuotaRecovery\(\)/);
  assert.match(page,/Дані не видалені й не пошкоджені/);
  assert.match(page,/Не потрібно постійно перезавантажувати сторінку/);
  const recovery=page.slice(page.indexOf('function D1QuotaRecovery'));
  assert.doesNotMatch(recovery,/env\.DB|fetch\(|getDashboardSnapshot|readSyncRevision/);
});
