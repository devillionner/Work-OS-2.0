import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanLibraryPlatforms, hasUnsupportedLibraryPlatforms } from '../lib/library.ts';

void test('advertisement platform metadata is canonical and rejects unsupported values',()=>{
  assert.deepEqual(cleanLibraryPlatforms([' WhatsApp ','whatsapp','TELEGRAM','viber']),['whatsapp','telegram','viber']);
  assert.equal(hasUnsupportedLibraryPlatforms(['whatsapp','linkedin']),true);
  assert.equal(hasUnsupportedLibraryPlatforms(['WhatsApp','telegram']),false);
});
