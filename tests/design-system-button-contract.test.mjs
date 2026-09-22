import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const button = readFileSync(join(process.cwd(), 'components', 'ui', 'button.tsx'), 'utf8');

void test('shared primary action uses neutral hierarchy instead of the blue accent', () => {
  assert.match(button, /default: 'bg-foreground text-background hover:bg-foreground\/85'/);
  assert.match(button, /link: 'text-accent-foreground/);
});

void test('shared button sizes keep the design-system minimum interaction target', () => {
  assert.match(button, /default:\s*\n\s*'h-\[42px\]/);
  assert.match(button, /xs: "h-\[42px\]/);
  assert.match(button, /sm: "h-\[42px\]/);
  assert.match(button, /lg: 'h-11/);
  assert.match(button, /icon: 'size-\[42px\]'/);
  assert.match(button, /'icon-xs':\s*\n\s*"size-\[42px\]/);
  assert.match(button, /'icon-sm':\s*\n\s*'size-\[42px\]/);
  assert.match(button, /'icon-lg': 'size-11'/);
});
