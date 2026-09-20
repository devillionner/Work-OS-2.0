import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('funnel conversion targets are editable together and bounded to percentages', async()=>{
  const settings=await readFile(new URL('../app/api/settings/route.ts',import.meta.url),'utf8');
  const dialog=await readFile(new URL('../components/today-settings-dialog.tsx',import.meta.url),'utf8');
  const analytics=await readFile(new URL('../components/analytics-workspace.tsx',import.meta.url),'utf8');
  for(const key of ['target_publication_rate','target_response_rate','target_booking_rate','target_completion_rate']) assert.match(settings,new RegExp(key));
  assert.match(settings,/Цільова конверсія має бути цілим відсотком від 0 до 100/);
  for(const label of ['Публікація / приєднання','Відгук / публікація','Запис / відгук','Проведено / запис']) assert.match(dialog,new RegExp(label));
  assert.match(analytics,/ціль не задана/);
  assert.match(analytics,/ціль \$\{target\}%/);
});


void test('Settings forwards funnel targets into the shared focus dialog', () => {
  const source = readFileSync(new URL('../components/settings-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /initialFunnelTargets=\{snapshot\.funnelTargets\}/);
});
