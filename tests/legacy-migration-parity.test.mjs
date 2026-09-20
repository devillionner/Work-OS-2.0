import assert from 'node:assert/strict';
import test from 'node:test';

import { FOCUS_DIRECTIONS } from '../lib/directions.ts';
import { buildLegacyMigrationDataset } from '../lib/legacy-migration.ts';

function backup(storage) {
  return JSON.stringify({ app: 'prototype-checker-full-backup', schemaVersion: 2, storage });
}
function settingMap(dataset) {
  return new Map(dataset.settings.map((item) => [item.key, JSON.parse(item.valueJson)]));
}
function kyivDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shortDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year.slice(-2)}`;
}

void test('legacy standalone report submission is preserved when history has no matching report', () => {
  const submittedAt = 1_750_000_000_000;
  const dataset = buildLegacyMigrationDataset(backup({
    'daily-report-submission-v1': JSON.stringify({
      date: '20.09.26',
      reportText: 'Єдиний збережений звіт',
      submittedAt,
    }),
  }), 'u');

  assert.equal(dataset.reports.length, 1);
  assert.equal(dataset.reports[0].reportDate, '2026-09-20');
  assert.equal(dataset.reports[0].reportText, 'Єдиний збережений звіт');
  assert.equal(dataset.reports[0].submittedAt, Math.floor(submittedAt / 1000));
  assert.ok(dataset.settings.some((item) => item.key === 'daily-report-submission-v1'));
});

void test('legacy report history array remains compatible and wins over duplicate standalone submission', () => {
  const dataset = buildLegacyMigrationDataset(backup({
    'daily-report-history-v1': JSON.stringify([{
      date: '19.09.26',
      reportText: 'Історичний масив',
      submittedAt: 1_749_000_000_000,
      updatedAt: 1_749_000_100_000,
    }]),
    'daily-report-submission-v1': JSON.stringify({
      date: '19.09.26',
      reportText: 'Старий дубль',
      submittedAt: 1_749_000_200_000,
    }),
  }), 'u');

  assert.equal(dataset.reports.length, 1);
  assert.equal(dataset.reports[0].reportDate, '2026-09-19');
  assert.equal(dataset.reports[0].reportText, 'Історичний масив');
});

void test('legacy focus and booking goals become active Work OS settings while raw source stays preserved', () => {
  const date = kyivDate();
  const month = date.slice(0, 7);
  const dataset = buildLegacyMigrationDataset(backup({
    'content-direction-focus-v1': JSON.stringify({
      disabled: [FOCUS_DIRECTIONS[0]],
      updatedAt: 1_750_000_000_000,
    }),
    'analytics-daily-goal-schedule-v1': JSON.stringify({
      defaultGoal: { ads: 100, chats: 30, responses: 5, records: 3 },
      periods: [{
        id: 'wide-period',
        start: '2000-01-01',
        end: '2099-12-31',
        goal: { ads: 120, chats: 40, responses: 6, records: 8 },
        updatedAt: 10,
      }],
      overrides: {
        [shortDate(date)]: { ads: 150, chats: 50, responses: 7, records: 9 },
      },
    }),
    'analytics-goals-v1': JSON.stringify({
      monthly: {
        '2020-01': { ads: 1000, chats: 300, responses: 50, records: 11 },
        [month]: { ads: 2200, chats: 660, responses: 110, records: 22 },
      },
    }),
  }), 'u');

  const settings = settingMap(dataset);
  assert.deepEqual(
    settings.get('focus_directions'),
    FOCUS_DIRECTIONS.filter((direction) => direction !== FOCUS_DIRECTIONS[0]),
  );
  assert.equal(settings.get('daily_booking_goal'), 9);
  assert.equal(settings.get('monthly_booking_goal'), 22);

  const rawSchedule = settings.get('analytics-daily-goal-schedule-v1');
  const rawGoals = settings.get('analytics-goals-v1');
  assert.equal(typeof rawSchedule.legacyStorageValue, 'string');
  assert.equal(typeof rawGoals.legacyStorageValue, 'string');
});

void test('legacy booking goal falls back to the active period and latest historical month', () => {
  const dataset = buildLegacyMigrationDataset(backup({
    'analytics-daily-goal-schedule-v1': JSON.stringify({
      defaultGoal: { records: 3 },
      periods: [{
        id: 'period',
        start: '2000-01-01',
        end: '2099-12-31',
        goal: { records: 6 },
        updatedAt: 1,
      }],
      overrides: {},
    }),
    'analytics-goals-v1': JSON.stringify({
      monthly: {
        '2001-01': { records: 10 },
        '2020-01': { records: 14 },
      },
    }),
  }), 'u');
  const settings = settingMap(dataset);
  assert.equal(settings.get('daily_booking_goal'), 6);
  assert.equal(settings.get('monthly_booking_goal'), 14);
});
