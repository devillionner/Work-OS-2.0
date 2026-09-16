import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/pwa-registration.tsx', import.meta.url), 'utf8');

void test('automatic update recovers from stalled service worker preparation', () => {
  assert.match(source, /const UPDATE_PREP_TIMEOUT_MS = 8_000/);
  assert.match(source, /await withTimeout\([\s\S]*navigator\.serviceWorker\.getRegistration\('\/'\)[\s\S]*registration\.update\(\)[\s\S]*UPDATE_PREP_TIMEOUT_MS/);
  assert.match(source, /phase: 'error'/);
  assert.match(source, /Не вдалося завершити оновлення/);
  assert.match(source, /Спробувати ще раз/);
});
