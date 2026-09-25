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
  assert.doesNotMatch(source,/action:'advance-discovery'/);
  assert.doesNotMatch(source,/Discovery source advanced via/);
});
void test('runner automates verified WhatsApp leave via CDP and retains operator-confirmed fallback',()=>{
  assert.match(source,/leaveWhatsappTaskViaCdp/);
  assert.match(source,/Verified WhatsApp leave accepted by Work OS/);
  assert.match(source,/leave automation stopped fail-closed/);
  assert.match(source,/if\(!process\.stdin\.isTTY\)return 'idle'/);
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
  assert.match(source,/if\(!result\)return 'idle'/);
  assert.match(source,/toWhatsAppWebInviteUrl/);
});


void test('runner claims WhatsApp autopost only after Discovery messenger tasks and posts a confirmed-send callback',()=>{
  assert.match(source,/\/api\/messenger-automation\/executor\?platform=whatsapp/);
  assert.match(source,/sendWhatsappAutopostViaCdp/);
  assert.match(source,/complete-whatsapp-autopost/);
  assert.match(source,/sendConfirmed:true/);
  assert.match(source,/WhatsApp autopost stopped fail-closed/);
  assert.match(source,/Confirmed WhatsApp autopost accepted by Work OS/);
});

void test('runner handles only confirmed messenger work and uses idle D1 backoff',()=>{
  assert.match(source,/const TASK_POLL_MS=3000/);
  assert.match(source,/const IDLE_POLL_MIN_MS=15000/);
  assert.match(source,/const IDLE_POLL_MAX_MS=60000/);
  assert.match(source,/outcome==='task'/);
  assert.match(source,/Math\.min\(IDLE_POLL_MAX_MS,idleDelayMs\*2\)/);
  assert.doesNotMatch(source,/SOURCE_ADVANCE_MS/);
  assert.doesNotMatch(source,/canAdvanceDiscoverySource/);
  assert.doesNotMatch(source,/action:'advance-discovery'/);
  assert.match(source,/Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP/);
  assert.match(source,/WHATSAPP_RUNTIME_COOLDOWN_MS=300000/);
  assert.match(source,/markWhatsappRuntimeBlocked/);
  assert.match(source,/backing off until the browser adapter is available/);
});


void test('non-interactive runner fails before API polling without a WhatsApp runtime and transient CDP state pauses automated messenger work',()=>{
  const startupGuard=source.indexOf('Non-interactive Discovery runner requires WORK_OS_WHATSAPP_CDP');
  const firstApi=source.indexOf("api('/api/chat-discovery/executor?limit=1')");
  assert.ok(startupGuard>0&&firstApi>startupGuard);
  assert.match(source,/WHATSAPP_RUNTIME_TRANSIENT_REASONS\.has\(automated\.reason\)/);
  assert.match(source,/markWhatsappRuntimeBlocked\('cdp_unavailable'\)/);
  assert.match(source,/clearWhatsappRuntimeBlock\(\)/);
});


void test('runner can read the one-time executor token from Wayland clipboard without putting the secret in argv',()=>{
  assert.match(source,/--token-from-clipboard/);
  assert.match(source,/execFileSync\('wl-paste',\['--no-newline'\]/);
  assert.match(source,/execFileSync\('wl-copy',\['--clear'\]/);
  assert.match(source,/Executor token loaded from clipboard/);
  assert.doesNotMatch(source,/console\.log\([^\n]*\btoken\b[^\n]*\)/i);
});
