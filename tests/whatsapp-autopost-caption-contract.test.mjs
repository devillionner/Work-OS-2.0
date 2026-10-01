import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

void test('mobile WhatsApp autopost has a caption composer with Library fallback',()=>{
  const workspace=read('components/platform-workspace.tsx');
  assert.match(workspace,/Текст автопоста/);
  assert.match(workspace,/Зберегти текст/);
  assert.match(workspace,/Залиште порожнім/);
  assert.match(workspace,/caption:whatsappAutopostCaption/);
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
