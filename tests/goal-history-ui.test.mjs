import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('REPORT-21 exposes goal history from owner-scoped versions and unversioned legacy current values', async () => {
  const source = await readFile(new URL('../app/api/settings/goal-history/route.ts', import.meta.url), 'utf8');
  assert.match(source, /FROM goal_versions/);
  assert.match(source, /FROM user_settings/);
  assert.match(source, /WHERE user_id=\?1/);
  assert.match(source, /daily_booking_goal/);
  assert.match(source, /monthly_booking_goal/);
  assert.match(source, /effective_on/);
  assert.match(source, /version/);
  assert.match(source, /unversioned/);
  assert.doesNotMatch(source, /UPDATE goal_versions|DELETE FROM goal_versions|INSERT INTO goal_versions/);
});
