import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const componentsDir = join(root, 'components');
const componentFiles = readdirSync(componentsDir, { recursive: true })
  .filter((name) => typeof name === 'string' && name.endsWith('.tsx'))
  .map((name) => join(componentsDir, name));

function text(path) { return readFileSync(path, 'utf8'); }

void test('components never fall back to native browser alert, prompt or confirm', () => {
  const offenders = componentFiles.filter((path) => /window\.(?:alert|prompt|confirm)\s*\(|\b(?:alert|prompt)\s*\(/.test(text(path)));
  assert.deepEqual(offenders, []);
});

void test('shared dialog close controls stay localized and touch-target contract remains explicit', () => {
  const dialog = text(join(componentsDir, 'ui', 'dialog.tsx'));
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(dialog, /sr-only">\u0417\u0430\u043a\u0440\u0438\u0442\u0438<\/span>/);
  assert.match(css, /\[data-slot="dialog-close"\]\s*\{[^}]*min-width:44px;[^}]*min-height:44px;/s);
});

void test('data-management UI avoids internal preview and staging-zone jargon', () => {
  for (const name of ['chat-csv-dialog.tsx', 'cloud-restore-dialog.tsx', 'legacy-import-dialog.tsx']) {
    const source = text(join(componentsDir, name));
    assert.doesNotMatch(source, />Preview</);
    assert.doesNotMatch(source, /staging-\u0437\u043e\u043d/);
  }
});
