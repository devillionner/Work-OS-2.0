import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

// Operator request 2026-10-06: the composer moved out of the queue page into its own dialog, because the
// caption field alone pushed the whole «Для публікації» queue below the fold.
void test('mobile WhatsApp autopost has a caption composer with Library fallback',()=>{
  const workspace=read('components/platform-workspace.tsx');
  const dialog=read('components/whatsapp-autopost-dialog.tsx');
  assert.match(dialog,/Текст автопоста/);
  assert.match(dialog,/Зберегти текст/);
  assert.match(dialog,/Залиште порожнім/);
  assert.match(workspace,/caption:whatsappAutopostCaption/);
  assert.match(workspace,/<WhatsappAutopostDialog open=\{autopostOpen\}/);
  // Nothing of the setup is left inline above the queue: the only mention left is the save confirmation.
  assert.doesNotMatch(workspace,/<span>Текст автопоста<\/span>/);
});

void test('caption override is snapshotted into jobs and does not require equality with Library text',()=>{
  const automation=read('lib/messenger-automation.ts');
  assert.match(automation,/if\(captionOverride\)\{[\s\S]*?payload=captionOverride;[\s\S]*?\}else\{[\s\S]*?payload=libraryPayload;/);
  assert.doesNotMatch(automation,/payload===row\.payload_text/);
  assert.match(automation,/row\.payload_text\.trim\(\)\.length>0/);
});

void test('caption persists in user settings and media is typed on WhatsApp task only',()=>{
  const caption=read('lib/whatsapp-autopost-caption.ts');
  const automation=read('lib/messenger-automation.ts');
  assert.match(caption,/whatsapp_autopost_caption_v1/);
  assert.match(caption,/INSERT INTO user_settings/);
  const wa=automation.slice(automation.indexOf('export type WhatsAppAutopostTask='),automation.indexOf('type WhatsAppAutopostRow='));
  const viber=automation.slice(automation.indexOf('export type ViberSafeNoteTask='),automation.indexOf('type JobRow='));
  assert.match(wa,/media:/);
  assert.doesNotMatch(viber,/media:/);
});

// Operator report 2026-10-06: WhatsApp chats opened by themselves with nothing in the runner tray, and a
// running batch could not be stopped at all. The dialog now shows progress and a stop; the tray names the
// process and its position in the batch.
void test('autopost reports its progress, can be stopped, and names itself in the runner tray',()=>{
  const dialog=read('components/whatsapp-autopost-dialog.tsx');
  const workspace=read('components/platform-workspace.tsx');
  const route=read('app/api/messenger-automation/route.ts');
  const automation=read('lib/messenger-automation.ts');
  const runner=read('scripts/chat-discovery-runner.mjs');

  assert.match(dialog,/Зупинити автопост/);
  assert.match(dialog,/`\$\{progress\.done\} з \$\{progress\.total\}`/);
  assert.match(workspace,/async function stopWhatsAppAutopostBatch/);
  assert.match(route,/body\.action==='cancel-whatsapp-autopost-batch'/);
  assert.match(automation,/export async function cancelWhatsAppAutopostBatch/);
  assert.match(automation,/export async function readWhatsAppAutopostProgress/);
  // Progress follows live-channel events, never a timer — the D1 budget rule.
  assert.match(workspace,/message\.process==='autopost'\)void refresh\(\)/);
  assert.doesNotMatch(workspace,/setInterval\([^)]*autopost/i);
  assert.match(runner,/setStatus\('working',`WhatsApp автопост: \$\{progress\}/);
});
