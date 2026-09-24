import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('analytics exposes the complete lesson outcome set', async()=>{
  const route=await readFile(new URL('../app/api/analytics/route.ts',import.meta.url),'utf8');
  const workspace=await readFile(new URL('../components/analytics-workspace.tsx',import.meta.url),'utf8');
  for(const eventType of ['lesson_booked','lesson_completed','lesson_cancelled','lesson_rescheduled','lesson_no_show'])
    assert.match(route,new RegExp(eventType));
  for(const label of ['Записано','Проведено','Скасовано','Перенесено','Не прийшов'])
    assert.match(workspace,new RegExp(label));
  assert.match(workspace,/перенесення не створює нового запису/);
});
