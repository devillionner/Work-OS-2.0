import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../lib/chats/publication.ts', import.meta.url), 'utf8');

void test('manual publication undo window is enforced by the domain, not only the UI', () => {
  assert.match(source, /const MANUAL_PUBLICATION_UNDO_WINDOW_SECONDS = 8/);
  assert.match(source, /SELECT p\.id,p\.source_key,p\.published_at,e\.id AS event_id/);
  assert.match(source, /publication\.published_at > now/);
  assert.match(source, /now - publication\.published_at > MANUAL_PUBLICATION_UNDO_WINDOW_SECONDS/);
  assert.match(source, /Час швидкого скасування минув/);
});
