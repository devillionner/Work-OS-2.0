import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildLegacyMigrationDataset } from '../lib/legacy-migration.ts';

const USER_ID = 'curator-lifecycle-test-user';
const SUBMITTED_AT_MS = 1_788_197_733_307;
const RESOLVED_AT_MS = 1_788_445_334_388;
const REQUEST_SOURCE_KEY = 'legacy:curator-request:curator-request-1';

function datasetFor(status, includeLesson = status === 'confirmed') {
  const lesson = {
    id: 'lesson-1',
    studentName: 'Test student',
    subject: 'Test subject',
    lessonDate: '08.09.26',
    bookingAccountingDate: '04.09.26',
    createdAt: RESOLVED_AT_MS,
  };
  const request = {
    id: 'curator-request-1',
    status,
    submittedAt: SUBMITTED_AT_MS,
    submittedDate: '31.08.26',
    resolvedAt: status === 'pending' ? null : RESOLVED_AT_MS,
    lessonId: includeLesson ? lesson.id : null,
  };
  const lead = {
    id: 'lead-1',
    name: 'Test lead',
    platform: 'telegram',
    createdAt: SUBMITTED_AT_MS,
    createdDate: '31.08.26',
    lessons: includeLesson ? [lesson] : [],
    curatorRequests: [request],
  };
  return buildLegacyMigrationDataset(JSON.stringify({
    storage: { 'shared-leads-v1': JSON.stringify([lead]) },
  }), USER_ID);
}

function curatorEvent(status, includeLesson) {
  const events = datasetFor(status, includeLesson).events
    .filter((event) => event.sourceKey === REQUEST_SOURCE_KEY);
  assert.equal(events.length, 1);
  return events[0];
}

void test('repeat pending imports retain one active stable curator event', () => {
  const first = curatorEvent('pending');
  const repeated = curatorEvent('pending');

  assert.equal(first.eventType, 'curator_booking_pending');
  assert.equal(first.cancelledAt, null);
  assert.equal(first.sourceKey, REQUEST_SOURCE_KEY);
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.sourceKey, first.sourceKey);
  assert.equal(repeated.cancelledAt, null);
});

void test('pending to confirmed cancels the same event and keeps one separate booking', () => {
  const pending = curatorEvent('pending');
  const confirmedDataset = datasetFor('confirmed');
  const confirmed = confirmedDataset.events.find((event) => event.sourceKey === REQUEST_SOURCE_KEY);

  assert.ok(confirmed);
  assert.equal(confirmed.id, pending.id);
  assert.equal(confirmed.cancelledAt, Math.floor(RESOLVED_AT_MS / 1000));
  assert.equal(confirmed.occurredAt, Math.floor(SUBMITTED_AT_MS / 1000));
  assert.equal(confirmed.eventDate, '2026-08-31');
  assert.deepEqual(JSON.parse(confirmed.metadataJson), {
    curatorRequestId: confirmedDataset.curatorRequests[0].id,
    status: 'confirmed',
  });

  const activeBookings = confirmedDataset.events.filter((event) =>
    ['lesson_booked', 'curator_booking_pending'].includes(event.eventType)
      && event.cancelledAt === null);
  assert.equal(activeBookings.length, 1);
  assert.equal(activeBookings[0].eventType, 'lesson_booked');
});

void test('pending to cancelled preserves history with the resolution timestamp', () => {
  const pending = curatorEvent('pending');
  const cancelled = curatorEvent('cancelled', false);

  assert.equal(cancelled.id, pending.id);
  assert.equal(cancelled.sourceKey, pending.sourceKey);
  assert.equal(cancelled.cancelledAt, Math.floor(RESOLVED_AT_MS / 1000));
  assert.equal(JSON.parse(cancelled.metadataJson).status, 'cancelled');
});

void test('repeat confirmed imports are stable and do not duplicate booking events', () => {
  const first = datasetFor('confirmed');
  const repeated = datasetFor('confirmed');
  const firstCurator = first.events.find((event) => event.sourceKey === REQUEST_SOURCE_KEY);
  const repeatedCurator = repeated.events.find((event) => event.sourceKey === REQUEST_SOURCE_KEY);

  assert.deepEqual(repeatedCurator, firstCurator);
  assert.equal(first.events.filter((event) => event.eventType === 'lesson_booked').length, 1);
  assert.equal(repeated.events.filter((event) => event.eventType === 'lesson_booked').length, 1);
});

void test('migration event upsert reconciles by stable source key and never deletes history', () => {
  const routeSource = readFileSync(
    new URL('../app/api/imports/legacy/migrate/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /ON CONFLICT\(user_id,source_key\) DO UPDATE/);
  assert.match(routeSource, /cancelled_at=excluded\.cancelled_at/);
  assert.doesNotMatch(routeSource, /DELETE\s+FROM\s+activity_events/i);
});
