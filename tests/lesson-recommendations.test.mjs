import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonDateRecommendations } from '../lib/leads/domain/lesson-recommendations.ts';

const epoch = (value) => Date.parse(value) / 1000;

void test('lesson booking recommends tomorrow and the day after in Kyiv business dates', () => {
  assert.deepEqual(lessonDateRecommendations(epoch('2026-09-10T20:30:00Z')), [
    { label: 'Завтра', date: '2026-09-11' },
    { label: 'Післязавтра', date: '2026-09-12' },
  ]);
  assert.deepEqual(lessonDateRecommendations(epoch('2026-12-31T22:30:00Z')), [
    { label: 'Завтра', date: '2027-01-02' },
    { label: 'Післязавтра', date: '2027-01-03' },
  ]);
});
