import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDirection, canonicalDirections, focusDirectionForTag, sameDirections } from '../lib/directions.ts';

void test('legacy IT and chess direction names collapse into one canonical focus without duplicates', () => {
  assert.equal(canonicalDirection('Програмування та IT'), 'ІТ та шахи');
  assert.equal(canonicalDirection('Шахи'), 'ІТ та шахи');
  assert.deepEqual(canonicalDirections(['Програмування та IT', 'Шахи', 'ІТ та шахи']), ['ІТ та шахи']);
  assert.equal(focusDirectionForTag('шахи'), 'ІТ та шахи');
  assert.equal(sameDirections(['Шахи', 'Англійська'], ['Англійська', 'ІТ та шахи']), true);
});
