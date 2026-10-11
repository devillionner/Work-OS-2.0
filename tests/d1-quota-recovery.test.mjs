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
