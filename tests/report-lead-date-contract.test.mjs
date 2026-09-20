import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const reports = readFileSync(join(root, 'components', 'reports-workspace.tsx'), 'utf8');
const editor = readFileSync(join(root, 'components', 'leads', 'lead-editor.tsx'), 'utf8');

void test('historical report creates a lead with the selected business date', () => {
  assert.match(reports, />Новий лід за дату<\/Button>/);
  assert.match(reports, /<LeadEditor defaultResponseDate=\{selected\}/);
  assert.match(reports, /if \(!selected \|\| !leadCommand\)/);
  assert.match(reports, /const id = await leadCommand\('create', leadData\)/);
  assert.match(editor, /value=\{lead \? \(lead\.responseDate \?\? ''\) : \(defaultResponseDate \?\? businessDate\(now\)\)\}/);
  assert.match(editor, /\{ responseDate: textValue\(f, 'responseDate'\) \}/);
});
