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

void test('the app shows a dedicated quota recovery surface without retry controls',()=>{
  // Home SSR only authenticates; the dashboard bootstrap reports the quota and the client renders the surface.
  const route=readFileSync(new URL('../app/api/dashboard-bootstrap/route.ts',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../components/work-os-bootstrap.tsx',import.meta.url),'utf8');
  assert.match(route,/isD1DailyRowReadLimit\(error\)/);
  assert.match(route,/code: 'd1_daily_read_limit'/);
  assert.match(bootstrap,/body\?\.code === 'd1_daily_read_limit'/);
  assert.match(bootstrap,/if \(quotaExceeded\) return <D1QuotaRecovery \/>/);
  assert.match(bootstrap,/function D1QuotaRecovery\(\)/);
  assert.match(bootstrap,/Дані не видалені й не пошкоджені/);
  assert.match(bootstrap,/Не потрібно постійно перезавантажувати сторінку/);
  const recovery=bootstrap.slice(bootstrap.indexOf('function D1QuotaRecovery'));
  assert.doesNotMatch(recovery,/fetch\(|onClick|<button/);
});
