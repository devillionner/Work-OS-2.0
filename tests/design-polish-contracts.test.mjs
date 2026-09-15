import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/design-polish.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

void test('screenshot-driven polish stylesheet is loaded after the shared visual system', () => {
  assert.match(layout, /import '\.\/globals\.css';\s*import '\.\/design-polish\.css';/);
});

void test('Today mobile focus card stacks instead of squeezing heading beside CTA', () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.focus-card \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.focus-actions \{ width: 100%; grid-template-columns: 1fr; \}/);
});

void test('Lead filters stay a three-column segmented row', () => {
  assert.match(css, /\.lead-filters \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

void test('normal mobile widths show all four platform tabs while very narrow widths can scroll', () => {
  assert.match(css, /\.platform-picker \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*\.platform-picker \{[\s\S]*overflow-x: auto/);
});

void test('Reports uses a bounded scrollable editor instead of content-sized page growth', () => {
  assert.match(css, /\.reports-editor-card \[data-slot="textarea"\] \{[\s\S]*field-sizing: fixed;[\s\S]*max-height: 520px;[\s\S]*overflow-y: auto/);
});
