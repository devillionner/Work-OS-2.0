import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

void test('WhatsApp autopost image is stored without a schema migration and exposed to the executor task',()=>{
  const media=read('lib/whatsapp-autopost-media.ts');
  const automation=read('lib/messenger-automation.ts');
  assert.match(media,/whatsapp_autopost_image_v1/);
  assert.match(media,/MAX_WHATSAPP_AUTOPOST_IMAGE_BYTES=640\*1024/);
  assert.match(media,/INSERT INTO user_settings/);
  assert.match(automation,/readWhatsAppAutopostImage\(db,userId,true\)/);
  assert.match(automation,/media:image\?/);
});

void test('mobile Platforms UI requires an image before starting a new WhatsApp autopost',()=>{
  const workspace=read('components/platform-workspace.tsx');
  assert.match(workspace,/Додати фото/);
  assert.match(workspace,/Замінити фото/);
  assert.match(workspace,/normalizeWhatsAppAutopostImage/);
  assert.match(workspace,/!whatsappAutopostImageLoaded\|\|!whatsappAutopostImage/);
  assert.match(workspace,/Профілі вручну підтверджувати не потрібно/);
});

void test('WhatsApp Web adapter injects the image in-memory and confirms a media message',()=>{
  const source=read('scripts/whatsapp-web-cdp.mjs');
  assert.match(source,/new DataTransfer\(\)/);
  assert.match(source,/new File\(\[bytes\]/);
  assert.match(source,/media_preview_not_ready/);
  assert.match(source,/row\.hasMedia===true/);
  assert.match(source,/mediaConfirmed:true/);
});
