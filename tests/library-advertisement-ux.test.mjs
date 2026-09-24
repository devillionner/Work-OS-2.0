import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cleanLibraryPlatforms, hasUnsupportedLibraryPlatforms } from '../lib/library.ts';

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


void test('advertisement platform metadata is canonical and rejects unsupported values',()=>{
  assert.deepEqual(cleanLibraryPlatforms([' WhatsApp ','whatsapp','TELEGRAM','viber']),['whatsapp','telegram','viber']);
  assert.equal(hasUnsupportedLibraryPlatforms(['whatsapp','linkedin']),true);
  assert.equal(hasUnsupportedLibraryPlatforms(['WhatsApp','telegram']),false);
});

void test('advertisement editor uses structured platforms and canonical subject directions',()=>{
  assert.match(workspace,/LIBRARY_ADVERTISEMENT_PLATFORMS\.map/);
  assert.match(workspace,/SUBJECT_OPTIONS\.map/);
  assert.match(workspace,/fieldset className="library-choice-group"/);
  assert.match(workspace,/updatePlatformChoice/);
  assert.match(workspace,/updateDirectionChoice/);
  assert.match(workspace,/library-extra-tags/);
  assert.match(workspace,/collection==='advertisement'&&!form\.platforms\.length/);
});

void test('all-platform advertisements remain visible under a specific platform filter',()=>{
  assert.match(workspace,/item\.platforms\.length===0\|\|item\.platforms\.some\(value=>canonicalLibraryPlatform\(value\)===platformFilter\)/);
  assert.match(workspace,/return \['all'\]/);
  assert.match(workspace,/all:'Усі платформи'/);
});

void test('advertisement API validates structured platform metadata',()=>{
  const route=readFileSync(new URL('../app/api/library/route.ts',import.meta.url),'utf8');
  assert.match(route,/hasUnsupportedLibraryPlatforms\(body\.platforms\)/);
  assert.match(route,/cleanLibraryPlatforms\(body\.platforms\)/);
  assert.match(route,/Оберіть хоча б одну платформу для оголошення/);
});

void test('structured advertisement controls stay responsive on narrow and mobile layouts',()=>{
  assert.match(css,/\.library-direction-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css,/\.library-language-grid, \.library-two-fields \{ grid-template-columns:1fr; \}/);
  assert.match(css,/\.library-choice-grid, \.library-direction-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css,/\.library-choice span \{ min-height:44px; \}/);
});
