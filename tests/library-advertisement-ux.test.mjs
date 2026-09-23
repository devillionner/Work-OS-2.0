import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace=readFileSync(new URL('../components/library-workspace.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

void test('advertisement library exposes platform filtering without affecting other collections',()=>{
  assert.match(workspace,/collection==='advertisement'&&<label className="library-platform-filter"/);
  assert.match(workspace,/<option value="all">Усі платформи<\/option>/);
  assert.match(workspace,/visibleItems=platformFilter==='all'\?items:items\.filter/);
  assert.match(workspace,/setPlatformFilter\('all'\)/);
});

void test('advertisement rows expose platform context and friendly platform labels',()=>{
  assert.match(workspace,/className="library-item-platforms"/);
  assert.match(workspace,/telegram:'Telegram',whatsapp:'WhatsApp',viber:'Viber',facebook:'Facebook'/);
});

void test('library advertisement controls collapse safely on mobile',()=>{
  assert.match(css,/\.library-toolbar \{ grid-template-columns:1fr; align-items:stretch; \}/);
  assert.match(css,/\.library-kind-picker \{ width:100%; overflow-x:auto;/);
  assert.match(css,/\.library-platform-filter select \{ width:100%; max-width:none; min-height:44px; \}/);
});
