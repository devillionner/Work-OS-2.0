import assert from 'node:assert/strict';
import test from 'node:test';
import { composeDailyReportText } from '../lib/reports/compose.ts';

void test('daily report draft is reconstructed deterministically from event facts', () => {
  const text = composeDailyReportText('2026-09-20',[
    {platform:'telegram',eventType:'publication',count:31},
    {platform:'telegram',eventType:'chat_joined',count:18},
    {platform:'telegram',eventType:'lead_created',count:2},
    {platform:'telegram',eventType:'lesson_booked',count:1},
    {platform:'telegram',eventType:'curator_booking_pending',count:1},
    {platform:'threads',eventType:'lead_created',count:1},
  ]);
  assert.match(text,/Загальний звіт 20\.09\.26/);
  assert.match(text,/Telegram\nОголошення: 31\nНові чати: 18\nВідгуки: 2\nЗаписи: 2/);
  assert.match(text,/Threads\nОголошення: 0\nВідгуки: 1\nЗаписи: 0/);
  const threadsBlock = text.split('\n\n').find((block) => block.startsWith('Threads\n')) || '';
  assert.doesNotMatch(threadsBlock,/Нові чати:/);
});

void test('daily report draft stays stable and includes unknown platforms without losing facts', () => {
  const text = composeDailyReportText('2026-01-02',[
    {platform:'custom',eventType:'publication',count:2},
    {platform:'custom',eventType:'publication',count:3},
    {platform:'custom',eventType:'lead_created',count:1},
  ]);
  assert.match(text,/Загальний звіт 02\.01\.26/);
  assert.match(text,/custom\nОголошення: 5\nНові чати: 0\nВідгуки: 1\nЗаписи: 0/);
});

void test('reports workspace uses suggested event draft only when no saved report exists', async () => {
  const { readFile }=await import('node:fs/promises');
  const source=await readFile(new URL('../components/reports-workspace.tsx',import.meta.url),'utf8');
  assert.match(source,/body\.selected\?\.text \|\| body\.suggestedText/);
  assert.match(source,/Чернетку автоматично сформовано з подій за цей день/);
});
