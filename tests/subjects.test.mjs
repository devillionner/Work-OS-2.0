import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUBJECT_OPTIONS,
  canonicalKnownSubject,
  canonicalSubject,
  canonicalSubjectList,
  canonicalSubjectValue,
  subjectSearchVariants,
} from '../lib/subjects.ts';
import { canonicalDirection } from '../lib/directions.ts';
import { cleanLibraryTags } from '../lib/library.ts';
import { leadFields, lessonFields } from '../lib/leads/application/inputs.ts';

void test('shared subject vocabulary canonicalizes known aliases without dropping unknown legacy values', () => {
  assert.ok(SUBJECT_OPTIONS.includes('Французька'));
  assert.ok(SUBJECT_OPTIONS.includes('ІТ'));
  assert.equal(canonicalKnownSubject(' English '), 'Англійська');
  assert.equal(canonicalSubjectValue('английский язык'), 'Англійська');
  assert.equal(canonicalSubjectValue('геометрія'), 'Математика');
  assert.equal(canonicalSubjectValue('programming'), 'ІТ');
  assert.equal(canonicalSubjectValue('Robotics'), 'Robotics');
  assert.equal(canonicalSubject(''), 'Предмет не вказано');
});
void test('shared subject lists merge aliases but preserve unrelated tags', () => {
  assert.deepEqual(
    canonicalSubjectList([
      'English',
      'англійська мова',
      'response',
      'Robotics',
      ' response ',
    ]),
    ['Англійська', 'response', 'Robotics'],
  );
  assert.deepEqual(
    cleanLibraryTags(['English', 'англійська мова', 'response', 'Robotics']),
    ['Англійська', 'response', 'Robotics'],
  );
});

void test('subject search expands both canonical and legacy spellings', () => {
  const english = subjectSearchVariants('English');
  assert.ok(english.includes('Англійська'));
  assert.ok(english.includes('английский'));
  assert.ok(english.includes('english'));

  const canonical = subjectSearchVariants('Англійська');
  assert.ok(canonical.includes('English'));
  assert.ok(canonical.includes('англійська мова'));

  assert.deepEqual(subjectSearchVariants('Robotics').includes('Robotics'), true);
});
void test('chat focus reuses the subject vocabulary while keeping its intentional IT/chess group', () => {
  assert.equal(canonicalDirection('programming'), 'ІТ та шахи');
  assert.equal(canonicalDirection('шахматы'), 'ІТ та шахи');
  assert.equal(canonicalDirection('French'), 'Французька');
  assert.equal(canonicalDirection('Robotics'), 'Robotics');
});

void test('new CRM subject writes use canonical names while arbitrary subjects remain allowed', () => {
  const now = Date.parse('2026-09-21T09:00:00Z') / 1000;
  const lead = leadFields({ name: 'Test', subject: 'English' }, null, now);
  assert.equal(lead.subject, 'Англійська');

  const lesson = lessonFields(
    { subject: 'немецкий', lessonDate: '2026-09-22' },
    undefined,
    now,
  );
  assert.equal(lesson.subject, 'Німецька');

  const legacy = leadFields({ name: 'Legacy', subject: 'Robotics' }, null, now);
  assert.equal(legacy.subject, 'Robotics');
});
