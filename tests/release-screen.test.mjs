import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('Settings exposes the transient update screen as a manual test trigger', () => {
  const settings = read('components/settings-workspace.tsx');
  assert.match(settings, /Тест екрану оновлення/);
  assert.match(settings, /setUpdatePreviewOpen\(true\)/);
  assert.match(settings, /<AppUpdateScreenPreview onClose=/);
  assert.doesNotMatch(settings, /AppReleaseDialog/);
});

void test('release dialog uses gentle motion and a stable internal scroll area', () => {
  const dialog = read('components/app-release-dialog.tsx');
  assert.match(dialog, /duration-200/);
  assert.match(dialog, /data-open:zoom-in-\[0\.985\]/);
  assert.match(dialog, /data-closed:zoom-out-\[0\.99\]/);
  assert.match(dialog, /app-release-scroll/);
  assert.match(dialog, /scrollbarGutter: 'stable'/);
});
