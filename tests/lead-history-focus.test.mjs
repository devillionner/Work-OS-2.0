import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('lead history dialog explicitly restores focus to its exact lead-level History trigger', () => {
  const dialog = readFileSync(new URL('../components/leads/history.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /const historyTrigger = useRef<HTMLButtonElement>\(null\);/);
  assert.match(workspace, /<Button ref=\{historyTrigger\} variant="ghost" size="sm" onClick=\{\(\) => setHistoryOpen\(true\)\}>Історія<\/Button>/);
  assert.match(workspace, /finalFocus=\{\(\) => historyTrigger\.current\}/);
  assert.match(dialog, /finalFocus\?: \(\) => HTMLElement \| null/);
  assert.doesNotMatch(dialog, /document\.querySelectorAll|leadHistoryTrigger/);
});

void test('lesson history dialog restores focus to the exact lesson History trigger', () => {
  const dialog = readFileSync(new URL('../components/leads/lesson-history.tsx', import.meta.url), 'utf8');
  const lessons = readFileSync(new URL('../components/leads/lessons.tsx', import.meta.url), 'utf8');
  assert.match(lessons, /const historyTrigger = useRef<HTMLButtonElement \| null>\(null\);/);
  assert.match(lessons, /historyTrigger\.current = event\.currentTarget;/);
  assert.match(lessons, /finalFocus=\{\(\) => historyTrigger\.current\}/);
  assert.match(dialog, /finalFocus\?: \(\) => HTMLElement \| null/);
  assert.match(dialog, /finalFocus=\{finalFocus\}/);
});
