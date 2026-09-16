import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('Settings test trigger opens the transient app update screen without a real reload', () => {
  const settings = read('components/settings-workspace.tsx');
  const preview = read('components/app-update-screen-preview.tsx');

  assert.match(settings, /AppUpdateScreenPreview/);
  assert.match(settings, /Тест екрану оновлення/);
  assert.match(settings, /Запустити тест/);
  assert.doesNotMatch(settings, /AppReleaseDialog/);

  assert.match(preview, /Оновлюємо Work OS/);
  assert.match(preview, /Work OS оновлено/);
  assert.match(preview, /setTimeout\(\(\) => setPhase\('finishing'\), 2_200\)/);
  assert.match(preview, /setTimeout\(onClose, 3_400\)/);
  assert.doesNotMatch(preview, /location\.reload/);
  assert.doesNotMatch(preview, /serviceWorker/);
});
