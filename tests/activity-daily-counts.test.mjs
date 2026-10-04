import assert from 'node:assert/strict';
import test from 'node:test';

import { activitySummaryStatement } from '../lib/activity-summary.ts';
import { readAnalyticsTrends } from '../lib/analytics-trends.ts';
import { localDatabase } from './helpers/local-d1.mjs';
import { ANALYTICS_FROM as FROM, ANALYTICS_TO as TO, meter, seedAnalytics } from './helpers/analytics-seed.mjs';

// activity_daily_counts (migration 0041) must stay exactly equal to activity_events after every kind of
// change the app makes, and the summary/trends read from it must equal the former full queries — kept
// here verbatim as the reference.

const REFERENCE_SUMMARY = `SELECT COALESCE(e.platform,l.platform,c.platform) AS platform,e.event_type,
    SUM(CASE WHEN e.cancelled_at IS NULL THEN 1 ELSE 0 END) AS count,
    SUM(CASE WHEN ?4 IS NOT NULL AND (e.occurred_at>?4 OR e.cancelled_at>?4) THEN 1 ELSE 0 END) AS changes_after_report
    FROM activity_events e
    LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
    LEFT JOIN chats c ON c.id=e.chat_id AND c.user_id=e.user_id
    WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3
      AND e.event_type NOT IN ('chat_state_changed','chat_bulk_added','chat_profile_changed','report_revision')
    GROUP BY COALESCE(e.platform,l.platform,c.platform),e.event_type`;

const REFERENCE_TRENDS = `SELECT event_date,event_type,COUNT(*) AS count
    FROM activity_events
    WHERE user_id=?1 AND event_date>=?2 AND event_date<=?3 AND cancelled_at IS NULL
      AND event_type IN ('chat_joined','publication','lead_created','lesson_booked','curator_booking_pending')
    GROUP BY event_date,event_type ORDER BY event_date,event_type`;

const sortRows = (rows) => [...rows]
  .map((row) => ({ platform: row.platform ?? null, event_type: row.event_type, count: Number(row.count), changes_after_report: Number(row.changes_after_report) }))
  .sort((a, b) => `${a.platform}|${a.event_type}`.localeCompare(`${b.platform}|${b.event_type}`));

async function assertCountersMatchEvents(db, step) {
  const counters = await db.prepare(`SELECT user_id,event_date,event_type,platform,active_count,cancelled_count FROM activity_daily_counts
    WHERE active_count+cancelled_count>0 ORDER BY 1,2,3,4`).all();
  const events = await db.prepare(`SELECT user_id,event_date,event_type,COALESCE(platform,'~none') AS platform,
      SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN cancelled_at IS NULL THEN 0 ELSE 1 END) AS cancelled_count
    FROM activity_events GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`).all();
  assert.deepEqual(counters.results, events.results, `counters drifted from activity_events after: ${step}`);
}

async function assertReadsMatchReference(db, step, ranges = [[FROM, TO], ['2027-02-10', '2027-02-10'], ['2027-03-01', '2027-03-31']]) {
  for (const [from, to] of ranges) {
    const summary = await activitySummaryStatement(db, 'u', from, to).all();
    const reference = await db.prepare(REFERENCE_SUMMARY).bind('u', from, to, null).all();
    assert.deepEqual(sortRows(summary.results), sortRows(reference.results), `summary ${from}..${to} differs after: ${step}`);

    const trends = await readAnalyticsTrends(db, 'u', from, to);
    const referenceTrends = await db.prepare(REFERENCE_TRENDS).bind('u', from, to).all();
    const expected = new Map();
    for (const row of referenceTrends.results) {
      const point = expected.get(row.event_date) || { joined: 0, publications: 0, responses: 0, bookings: 0 };
      if (row.event_type === 'chat_joined') point.joined += row.count;
      if (row.event_type === 'publication') point.publications += row.count;
      if (row.event_type === 'lead_created') point.responses += row.count;
      if (row.event_type === 'lesson_booked' || row.event_type === 'curator_booking_pending') point.bookings += row.count;
      expected.set(row.event_date, point);
    }
    for (const point of trends) {
      const want = expected.get(point.date) || { joined: 0, publications: 0, responses: 0, bookings: 0 };
      assert.deepEqual({ joined: point.joined, publications: point.publications, responses: point.responses, bookings: point.bookings }, want,
        `trends ${point.date} differ after: ${step}`);
    }
  }
}

async function check(db, step) {
  await assertCountersMatchEvents(db, step);
  await assertReadsMatchReference(db, step);
}

void test('daily counters stay equal to activity_events and summary/trends equal the full queries through every kind of change', async (t) => {
  const db = await localDatabase(t);
  await seedAnalytics(db);
  await seedAnalytics(db, { owner: 'other' });
  // An event whose stored platform is '' (not NULL) keeps its own '' group, like the full query did.
  await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
    VALUES ('blank-1','u','publication','','u-chat-1',1,'2027-02-10','{}','blank-1')`).run();
  await check(db, 'seed');

  await db.prepare(`UPDATE activity_events SET cancelled_at=99 WHERE user_id='u' AND event_type='publication' AND event_date='2027-02-10'`).run();
  await check(db, 'cancel a whole day of publications (bucket with only cancelled events)');

  await db.prepare(`UPDATE activity_events SET cancelled_at=NULL WHERE user_id='u' AND event_type='publication' AND event_date='2027-02-10' AND id LIKE '%5'`).run();
  await check(db, 'restore some cancelled events');

  await db.prepare(`UPDATE activity_events SET event_date='2027-03-15' WHERE id IN (SELECT id FROM activity_events WHERE user_id='u' AND event_type='lead_created' LIMIT 7)`).run();
  await check(db, 'lead response date correction moves events to another day');

  await db.prepare(`UPDATE leads SET platform='whatsapp' WHERE user_id='u' AND platform='telegram'`).run();
  await check(db, 'lead platform edit (lead events re-attributed live, counters untouched)');

  await db.prepare(`UPDATE leads SET source_chat_id=NULL WHERE id='u-lead-1'`).run();
  await db.prepare(`DELETE FROM leads WHERE id='u-lead-2'`).run();
  await check(db, 'lead source cleared and a lead deleted (events keep, lead_id set NULL)');

  await db.prepare(`UPDATE activity_events SET platform='viber' WHERE id IN (SELECT id FROM activity_events WHERE user_id='u' AND platform='telegram' LIMIT 11)`).run();
  await db.prepare(`UPDATE activity_events SET platform=NULL WHERE id IN (SELECT id FROM activity_events WHERE user_id='u' AND platform='whatsapp' AND event_type='chat_joined' LIMIT 5)`).run();
  await db.prepare(`UPDATE activity_events SET event_type='curator_booking_pending' WHERE id IN (SELECT id FROM activity_events WHERE user_id='u' AND event_type='lesson_booked' LIMIT 3)`).run();
  await check(db, 'event platform / type changed in place');

  await db.prepare(`DELETE FROM activity_events WHERE id IN (SELECT id FROM activity_events WHERE user_id='u' AND event_date='2027-01-20')`).run();
  await db.prepare(`DELETE FROM chats WHERE id='u-chat-7'`).run();
  await check(db, 'events and a chat permanently deleted');

  await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key,cancelled_at)
    VALUES ('late-1','u','publication','telegram','u-chat-3',1,'2027-03-31','{}','late-1',NULL),
           ('late-2','u','lead_created',NULL,NULL,1,'2027-03-31','{}','late-2',5)`).run();
  await check(db, 'new events, one already cancelled');

  // A submitted report still compares event times, so it keeps reading the events themselves.
  const withReport = await activitySummaryStatement(db, 'u', '2027-02-10', '2027-02-10', 50).all();
  const referenceWithReport = await db.prepare(REFERENCE_SUMMARY).bind('u', '2027-02-10', '2027-02-10', 50).all();
  assert.deepEqual(sortRows(withReport.results), sortRows(referenceWithReport.results));
});

void test('summary and trends over 90 days read day counters, not every event', async (t) => {
  const db = await localDatabase(t);
  const events = await seedAnalytics(db);
  const metered = meter(db);

  const referenceSummary = await db.prepare(REFERENCE_SUMMARY).bind('u', FROM, TO, null).all();
  await activitySummaryStatement(metered.db, 'u', FROM, TO).all();
  const summaryRows = metered.take();

  const referenceTrends = await db.prepare(REFERENCE_TRENDS).bind('u', FROM, TO).all();
  await readAnalyticsTrends(metered.db, 'u', FROM, TO);
  const trendRows = metered.take();

  console.log('DAILY_COUNTS_ROWS', { events, summary: { reference: referenceSummary.meta.rows_read, now: summaryRows }, trends: { reference: referenceTrends.meta.rows_read, now: trendRows } });
  // 90 days × a handful of types/platforms of counters, plus the platform-less lead events read live.
  assert.ok(summaryRows < referenceSummary.meta.rows_read / 5, `summary read ${summaryRows} rows`);
  assert.ok(trendRows < referenceTrends.meta.rows_read / 5, `trends read ${trendRows} rows`);
});
