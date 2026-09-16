import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const lessons = readFileSync(join(root, 'components', 'leads', 'lessons.tsx'), 'utf8');
const client = readFileSync(join(root, 'components', 'leads', 'client.ts'), 'utf8');

void test('Lead lesson card exposes explicit attendance outcomes', () => {
  assert.match(lessons, />\s*Проведено\s*<\/Button>/);
  assert.match(lessons, />\s*Перенести\s*<\/Button>/);
  assert.match(lessons, />\s*Учень пішов\s*<\/Button>/);
  assert.match(lessons, /status: 'completed'/);
  assert.match(lessons, /status: 'no-show'/);
});

void test('Lead lesson attendance stays separate from bookings and reschedules', () => {
  assert.match(lessons, /attendanceCount = detail\.lessons\.filter\(\(lesson\) => lesson\.status === 'completed'\)\.length/);
  assert.match(lessons, /Відвідувань:/);
  assert.match(lessons, /Урок буде зараховано як одне відвідування/);
  assert.match(lessons, /Відвідування не буде зараховано/);
  assert.match(lessons, /mode: 'book' \| 'update' \| 'reschedule'/);
});

void test('Lead lesson result labels use business terminology', () => {
  assert.match(client, /completed: 'Проведено'/);
  assert.match(client, /'no-show': 'Учень пішов'/);
  assert.match(client, /rescheduled: 'Перенесено'/);
});
