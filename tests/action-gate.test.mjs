import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionGate } from '../lib/action-gate.ts';

void test('workspace gate stops simultaneous controls and releases after completion', async () => {
  const run=createActionGate(); let release; const calls=[];
  const pending=run(async()=>{calls.push('account');await new Promise(resolve=>{release=resolve;});});
  assert.equal(await run(async()=>{calls.push('chat');}),false);
  release(); assert.equal(await pending,true);
  assert.equal(await run(async()=>{calls.push('chat');}),true);
  assert.deepEqual(calls,['account','chat']);
});

void test('network failure cannot leave the workspace gate locked or replay the failed action', async () => {
  const run=createActionGate();let calls=0;
  await assert.rejects(run(async()=>{calls++;throw new Error('offline');}),/offline/);
  assert.equal(await run(async()=>{calls++;}),true);
  assert.equal(calls,2);
});
