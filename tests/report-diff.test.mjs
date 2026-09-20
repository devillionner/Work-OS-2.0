import assert from 'node:assert/strict';
import test from 'node:test';
import { diffReportText } from '../lib/reports/diff.ts';

void test('report text diff keeps ordered line additions and removals', () => {
  const diff = diffReportText('a\nb\nc', 'a\nB\nc\nd');
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.equal(diff.truncated, false);
  assert.deepEqual(diff.operations.map(item => [item.kind,item.text]), [
    ['same','a'],['added','B'],['removed','b'],['same','c'],['added','d'],
  ]);
});

void test('report text diff is bounded for large historical reports', () => {
  const previous = Array.from({ length: 260 }, (_, index) => 'old-' + index).join('\n');
  const current = Array.from({ length: 260 }, (_, index) => 'new-' + index).join('\n');
  const diff = diffReportText(previous,current);
  assert.equal(diff.truncated,true);
  assert.equal(diff.maxLines,200);
  assert.ok(diff.operations.length <= 400);
});

void test('report history exposes comparison without changing restore semantics', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../components/report-history-dialog.tsx',import.meta.url),'utf8');
  assert.match(source,/Порівняти з поточною/);
  assert.match(source,/diffReportText/);
  assert.match(source,/Відновити цю версію/);
  assert.match(source,/expectedRevision: currentRevision/);
  assert.match(source,/Порівняння з версією/);
});
