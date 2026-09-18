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


void test('chat history restores focus to the exact row trigger', () => {
  const dialog = readFileSync(new URL('../components/chat-history-dialog.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /const historyTrigger=useRef<HTMLButtonElement\|null>\(null\);/);
  assert.match(workspace, /historyTrigger\.current=event\.currentTarget;/);
  assert.match(workspace, /finalFocus=\{\(\)=>historyTrigger\.current\}/);
  assert.match(dialog, /finalFocus\?:\(\)=>HTMLElement\|null/);
  assert.match(dialog, /finalFocus=\{finalFocus\}/);
});

void test('library and report history return focus to their visible trigger buttons', () => {
  const library = readFileSync(new URL('../components/library-workspace.tsx', import.meta.url), 'utf8');
  const libraryDialog = readFileSync(new URL('../components/library-history-dialog.tsx', import.meta.url), 'utf8');
  const reports = readFileSync(new URL('../components/reports-workspace.tsx', import.meta.url), 'utf8');
  const reportDialog = readFileSync(new URL('../components/report-history-dialog.tsx', import.meta.url), 'utf8');
  assert.match(library, /ref=\{historyTrigger\} variant="ghost"/);
  assert.match(library, /finalFocus=\{\(\)=>historyTrigger\.current\}/);
  assert.match(libraryDialog, /finalFocus=\{finalFocus\}/);
  assert.match(reports, /ref=\{reportHistoryTrigger\} variant="outline"/);
  assert.match(reports, /finalFocus=\{\(\) => reportHistoryTrigger\.current\}/);
  assert.match(reportDialog, /finalFocus=\{finalFocus\}/);
});


void test('profile and publish dialogs return focus to the exact chat-row actions', () => {
  const workspace = readFileSync(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../components/chat-profile-dialog.tsx', import.meta.url), 'utf8');
  const publish = readFileSync(new URL('../components/chat-publish-dialog.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /profileTrigger\.current=event\.currentTarget/);
  assert.match(workspace, /publishTrigger\.current=event\.currentTarget/);
  assert.match(workspace, /finalFocus=\{\(\)=>profileTrigger\.current\}/);
  assert.match(workspace, /finalFocus=\{\(\)=>publishTrigger\.current\}/);
  assert.match(profile, /finalFocus=\{finalFocus\}/);
  assert.match(publish, /finalFocus=\{finalFocus\}/);
});
