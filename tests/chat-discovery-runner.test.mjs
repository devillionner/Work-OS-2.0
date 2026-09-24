import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../scripts/chat-discovery-runner.mjs',import.meta.url),'utf8');

void test('runner consumes paired executor tasks and posts guarded callbacks',()=>{
  assert.match(source,/WORK_OS_EXECUTOR_TOKEN/);
  assert.ok(source.includes('Authorization:'));
  assert.match(source,/\/api\/chat-discovery\/executor\?limit=1/);
  assert.match(source,/action:'inspect'/);
  assert.match(source,/action:'executor-leave'/);
  assert.match(source,/action:'advance-discovery'/);
  assert.match(source,/Discovery source advanced via/);
});
void test('runner automates verified WhatsApp leave via CDP and retains operator-confirmed fallback',()=>{
  assert.match(source,/leaveWhatsappTaskViaCdp/);
  assert.match(source,/Verified WhatsApp leave accepted by Work OS/);
  assert.match(source,/leave automation stopped fail-closed/);
  assert.match(source,/if\(!process\.stdin\.isTTY\)return true/);
});

void test('runner requires operator confirmation before reporting external leave',()=>{
  const prompt=source.indexOf('Confirm only AFTER you actually left the chat');
  const callback=source.indexOf("action:'executor-leave'");
  assert.ok(prompt>0&&callback>prompt);
  assert.match(source,/xdg-open/);
});

void test('runner verifies the exact messenger target before inspection or leave callbacks',()=>{
  const targetPrompt=source.indexOf('Exact target verified as');
  const inspectCallback=source.indexOf("action:'inspect'");
  const leaveCallback=source.indexOf("action:'executor-leave'");
  assert.ok(targetPrompt>0&&inspectCallback>targetPrompt);
  assert.match(source,/targetVerified:true/);
  assert.ok(leaveCallback>targetPrompt);
  assert.match(source,/leave skipped fail-closed/);
});

void test('runner fails closed on ambiguous membership and requires a confirmed join for join tasks',()=>{
  assert.match(source,/function membershipState/);
  assert.match(source,/membership_not_confirmed/);
  assert.match(source,/task\.action==='join_and_inspect'&&membership!=='joined'/);
  assert.match(source,/join_not_confirmed/);
  const guard=source.indexOf("reason:'join_not_confirmed'");
  const inspected=source.indexOf("status:'inspected'");
  assert.ok(guard>0&&inspected>guard);
});


void test('runner uses optional WhatsApp Web CDP automation but sends no callback for ambiguous browser state',()=>{
  assert.match(source,/WORK_OS_WHATSAPP_CDP/);
  assert.match(source,/inspectWhatsappTaskViaCdp/);
  assert.match(source,/automation stopped fail-closed/);
  assert.match(source,/if\(!result\)return true/);
  assert.match(source,/toWhatsAppWebInviteUrl/);
});
