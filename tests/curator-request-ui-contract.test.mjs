import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const lessons = readFileSync(join(root, 'components', 'leads', 'lessons.tsx'), 'utf8');
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

void test('pending curator requests expose a guarded cancellation flow on desktop and mobile', () => {
  assert.match(lessons, /Скасувати запит/);
  assert.match(lessons, /setCancelRequest\(request\.id\)/);
  assert.match(lessons, /title="Скасувати запит куратору"/);
  assert.match(lessons, /mutate\(\s*'curator_cancel'/);
  assert.match(lessons, /Field label="Причина скасування \*" name="reason" required/);
  assert.match(lessons, /Запит залишиться в історії, його попередній booking-показник буде скасовано/);
  assert.match(css, /\.lead-simple-list > li > \[data-slot="button"\] \{ width:100%; min-height:44px; \}/);
});
