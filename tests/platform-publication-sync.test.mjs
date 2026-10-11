import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('published and undo return an authoritative platform publication snapshot', () => {
  const route=read('app/api/chats/route.ts');
  assert.match(route,/publicationState = await readPublicationState/);
  assert.match(route,/chatPublishedToday/);
  assert.match(route,/publishedToday:publishedResult\.results/);
  assert.match(route,/availableToday:availableResult\.results/);
  assert.match(route,/cancelled_at IS NULL/);
  assert.match(route,/resolveDailyPublicationGoal\(goalValue,date\)/);
});

void test('active WhatsApp autopost is a server-side chat mutation fence, not only a disabled button', () => {
  const route=read('app/api/chats/route.ts');
  assert.match(route,/status IN \('pending','claimed'\)/);
  assert.match(route,/виконується WhatsApp автопублікація/);
});

