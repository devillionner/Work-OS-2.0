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

void test('closed mobile sidebar is removed from keyboard interaction until opened', () => {
  const css = text(join(root, 'app', 'globals.css'));
  assert.match(css, /\.work-sidebar \{[^}]*translateX\(-100%\)[^}]*visibility:hidden;[^}]*pointer-events:none;/s);
  assert.match(css, /\.work-sidebar\.is-open \{[^}]*translateX\(0\)[^}]*visibility:visible;[^}]*pointer-events:auto;/s);
});

void test('data-management UI avoids internal preview and staging-zone jargon', () => {
  for (const name of ['chat-csv-dialog.tsx', 'cloud-restore-dialog.tsx', 'legacy-import-dialog.tsx']) {
    const source = text(join(componentsDir, name));
    assert.doesNotMatch(source, />Preview</);
    assert.doesNotMatch(source, /staging-\u0437\u043e\u043d/);
  }
});


void test('user-facing source is free from mojibake and placeholder corruption', () => {
  const roots = ['app', 'components', 'lib'];
  const offenders = [];
  for (const folder of roots) {
    const dir = join(root, folder);
    const files = readdirSync(dir, { recursive: true })
      .filter((name) => typeof name === 'string' && /\.(?:ts|tsx)$/.test(name))
      .map((name) => join(dir, name));
    for (const path of files) {
      if (/(?:Ð.|Ñ.|Ã.|Â.|â€|�|\?{4,})/.test(text(path))) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, []);
});

void test('app-specific native buttons always declare an explicit type', () => {
  const files = readdirSync(componentsDir, { recursive: true })
    .filter((name) => typeof name === 'string' && name.endsWith('.tsx') && !name.replaceAll('\\','/').startsWith('ui/'))
    .map((name) => join(componentsDir, name));
  const offenders = [];
  for (const path of files) {
    const source = text(path);
    for (const match of source.matchAll(/<button\b[^>]*>/gs)) {
      if (!/\btype\s*=/.test(match[0])) offenders.push(path);
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});

void test('mobile drawer moves focus into the drawer and isolates the background', () => {
  const shell = text(join(componentsDir, 'work-os-shell.tsx'));
  assert.match(shell, /mobileCloseRef\.current\?\.focus\(\)/);
  assert.match(shell, /mobileDrawerTriggerRef\.current/);
  assert.match(shell, /<main className="work-main" inert=\{mobileOpen \? true : undefined\}>/);
  assert.match(shell, /<h1 ref=\{pageHeadingRef\} tabIndex=\{-1\}>/);
});

void test('Telegram account creation field has an explicit accessible name', () => {
  const platform = text(join(componentsDir, 'platform-workspace.tsx'));
  assert.match(platform, /placeholder="Назва нового акаунта" aria-label="Назва нового Telegram-акаунта"/);
});
