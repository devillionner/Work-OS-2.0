import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/workday/route.ts', import.meta.url), 'utf8');

void test('workday exposes an uncached authenticated server snapshot for cross-device sync', () => {
  assert.match(route, /export async function GET\(\): Promise<Response>/);
  assert.match(route, /readWorkdaySnapshot\(env\.DB, user\.id, today, now\)/);
  assert.match(route, /'Cache-Control': 'no-store'/);
});

void test('ended current workday reset is explicit and server guarded', () => {
  assert.match(route, /action === 'reset'/);
  assert.match(route, /workDate !== today/);
  assert.match(route, /resetWorkday\(env\.DB, args\)/);
  assert.match(route, /workday: null, today/);
});
