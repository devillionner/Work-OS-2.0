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


void test('legacy confirmed archive exit becomes an immutable chat state event', () => {
  const joinedAt = 1_750_100_000_000;
  const archivedAt = 1_750_200_000_000;
  const confirmedAt = 1_750_300_000_000;
  const dataset = buildLegacyMigrationDataset(backup({
    'deleted-groups-archive-v1': JSON.stringify({
      whatsapp: [{
        archiveId: 'wa-archive-1',
        link: 'https://chat.whatsapp.com/ExitParityExample',
        name: 'Archived WhatsApp',
        status: '✅',
        joinedAt,
        archivedAt,
        membershipExitRequired: true,
        membershipExitConfirmedAt: confirmedAt,
      }],
    }),
  }), 'u');

  assert.equal(dataset.chats.length, 1);
  assert.equal(dataset.chats[0].workflowStatus, 'archived');
  const event = dataset.events.find((item) => item.eventType === 'chat_state_changed');
  assert.ok(event);
  assert.equal(event.chatId, dataset.chats[0].id);
  assert.equal(event.occurredAt, Math.floor(confirmedAt / 1000));
  assert.deepEqual(JSON.parse(event.metadataJson), {
    action: 'confirm_leave',
    source: 'legacy-migration',
  });
  assert.match(event.sourceKey, /^legacy:chat-leave-confirmed:/);
});


void test('legacy Telegram schedule and manual selection migrate per account with published history linkage', () => {
  const publishedTs = Date.parse('2026-09-20T10:00:00Z');
  const pendingTs = Date.parse('2026-09-20T10:15:00Z');
  const assignedTs = Date.parse('2026-09-20T09:55:00Z');
  const dataset = buildLegacyMigrationDataset(backup({
    'telegram-multi-account-v1': JSON.stringify({
      selected: 'tg2',
      accounts: [{ id: 'tg2', number: 2, name: 'Work TG 2' }],
    }),
    'telegram-groups-checklist-v1': JSON.stringify([
      {
        n: 10,
        name: 'Published chat',
        link: 'https://t.me/published_parity_chat',
        status: '✅',
        telegramAccountId: 'tg2',
        joinedAt: Date.parse('2026-09-19T08:00:00Z'),
        publicationDates: ['20.09.26'],
        lastPublicationAt: publishedTs,
      },
      {
        n: 11,
        name: 'Pending chat',
        link: 'https://t.me/pending_parity_chat',
        status: '✅',
        telegramAccountId: 'tg2',
        joinedAt: Date.parse('2026-09-19T09:00:00Z'),
      },
    ]),
    'telegram-announce-schedules-by-account-v1': JSON.stringify({
      version: 2,
      accounts: {
        tg2: {
          interval: 15,
          slots: [
            {
              id: 'published-slot',
              ts: publishedTs,
              date: '20.09.26',
              published: true,
              source: 'group-list',
              groupNumber: 10,
              assignedAt: assignedTs,
            },
            {
              id: 'pending-slot',
              ts: pendingTs,
              date: '20.09.26',
              published: false,
              source: 'group-schedule',
              groupNumber: 11,
              assignedAt: assignedTs,
            },
          ],
        },
      },
    }),
    'telegram-schedule-selection-v1': JSON.stringify({
      version: 1,
      accounts: {
        tg2: {
          enabled: true,
          groupNumbers: [11],
          updatedAt: Date.parse('2026-09-20T09:56:00Z'),
        },
      },
    }),
  }), 'u');

  assert.equal(dataset.scheduleSettings.length, 1);
  const setting = dataset.scheduleSettings[0];
  assert.equal(setting.accountId, 'u:tg2');
  assert.equal(setting.intervalMinutes, 15);
  assert.equal(setting.selectionMode, 'manual');
  const pendingChat = dataset.chats.find((chat) => chat.link.includes('pending_parity_chat'));
  const publishedChat = dataset.chats.find((chat) => chat.link.includes('published_parity_chat'));
  assert.ok(pendingChat);
  assert.ok(publishedChat);
  assert.deepEqual(JSON.parse(setting.manualChatIdsJson), [pendingChat.id]);
  assert.equal(setting.baseAt, Math.floor(pendingTs / 1000));

  assert.equal(dataset.scheduleSlots.length, 2);
  const completed = dataset.scheduleSlots.find((slot) => slot.status === 'completed');
  const pending = dataset.scheduleSlots.find((slot) => slot.status === 'pending');
  assert.ok(completed);
  assert.ok(pending);
  assert.equal(completed.accountId, 'u:tg2');
  assert.equal(completed.chatId, publishedChat.id);
  assert.equal(completed.scheduledAt, Math.floor(publishedTs / 1000));
  assert.equal(completed.completedAt, Math.floor(publishedTs / 1000));
  assert.ok(completed.publicationId);
  assert.equal(pending.chatId, pendingChat.id);
  assert.equal(pending.scheduledAt, Math.floor(pendingTs / 1000));
  assert.equal(pending.completedAt, null);
  assert.equal(pending.publicationId, null);
});

void test('legacy Telegram schedule fails closed on duplicate pending assignment', () => {
  const firstTs = Date.parse('2026-09-20T10:00:00Z');
  const secondTs = Date.parse('2026-09-20T10:15:00Z');
  assert.throws(() => buildLegacyMigrationDataset(backup({
    'telegram-multi-account-v1': JSON.stringify({
      selected: 'tg1',
      accounts: [{ id: 'tg1', number: 1, name: 'TG 1' }],
    }),
    'telegram-groups-checklist-v1': JSON.stringify([{
      n: 5,
      name: 'Repeated pending',
      link: 'https://t.me/repeated_pending_parity',
      status: '✅',
      telegramAccountId: 'tg1',
      joinedAt: Date.parse('2026-09-19T08:00:00Z'),
    }]),
    'telegram-announce-schedules-by-account-v1': JSON.stringify({
      accounts: {
        tg1: {
          interval: 15,
          slots: [
            { id: 'slot-a', ts: firstTs, date: '20.09.26', published: false, groupNumber: 5 },
            { id: 'slot-b', ts: secondTs, date: '20.09.26', published: false, groupNumber: 5 },
          ],
        },
      },
    }),
  }), 'u'), /repeats a pending chat/);
});
