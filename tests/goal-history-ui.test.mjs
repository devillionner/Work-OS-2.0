import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('REPORT-21 exposes goal history from owner-scoped versions', async () => {
  const source = await readFile(new URL('../app/api/settings/goal-history/route.ts', import.meta.url), 'utf8');
  assert.match(source, /FROM goal_versions/);
  assert.match(source, /WHERE user_id=\?1/);
  assert.match(source, /daily_booking_goal/);
  assert.match(source, /monthly_booking_goal/);
  assert.match(source, /effective_on/);
  assert.match(source, /version/);
  assert.doesNotMatch(source, /UPDATE goal_versions|DELETE FROM goal_versions/);
});

void test('REPORT-21 Settings makes historical effective dates visible to the user', async () => {
  const dialog = await readFile(new URL('../components/goal-history-dialog.tsx', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../components/settings-workspace.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /Історія цілей/);
  assert.match(dialog, /не переписує план минулих днів або місяців/);
  assert.match(dialog, /Діє з/);
  assert.match(dialog, /Денна ціль/);
  assert.match(dialog, /Місячна ціль/);
  assert.match(settings, /GoalHistoryDialog/);
  assert.match(settings, />Історія<\/Button>/);
});
