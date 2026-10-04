import assert from 'node:assert/strict';
import test from 'node:test';

import { chatActivityStatement } from '../lib/analytics-chats.ts';
import { localDatabase } from './helpers/local-d1.mjs';
import { ANALYTICS_FROM as FROM, ANALYTICS_TO as TO, seedAnalytics, meter } from './helpers/analytics-seed.mjs';

// The Analytics page aggregates every activity event of the chosen range, so its D1 cost grows with the
// amount of work, not with a timer. These tests pin both sides of every rewrite: the numbers must equal
// the original SQL exactly (kept below as the reference), and the rows read must stay bounded.

// Reference: the per-chat breakdown exactly as app/api/analytics/route.ts ran it before 2026-10-04.
const REFERENCE_CHAT_ACTIVITY = `SELECT COALESCE(e.chat_id,l.source_chat_id) AS chat_id,c.name,c.platform,c.workflow_status,
    pr.language,pr.directions_json,
    SUM(CASE WHEN e.event_type='chat_joined' THEN 1 ELSE 0 END) AS joined,
    SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
    SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
    SUM(CASE WHEN e.event_type IN ('lesson_booked','curator_booking_pending') THEN 1 ELSE 0 END) AS bookings
  FROM activity_events e
  LEFT JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
  LEFT JOIN chats c ON c.id=COALESCE(e.chat_id,l.source_chat_id) AND c.user_id=e.user_id
  LEFT JOIN chat_profiles pr ON pr.chat_id=c.id
  WHERE e.user_id=?1 AND e.event_date>=?2 AND e.event_date<=?3 AND e.cancelled_at IS NULL
    AND COALESCE(e.chat_id,l.source_chat_id) IS NOT NULL
  GROUP BY COALESCE(e.chat_id,l.source_chat_id),c.name,c.platform,c.workflow_status,pr.language,pr.directions_json
  HAVING joined>0 OR publications>0 OR responses>0 OR bookings>0
  ORDER BY publications DESC,responses DESC,bookings DESC,joined DESC,c.name ASC LIMIT 100`;

void test('per-chat analytics breakdown equals the reference SQL and reads fewer rows', async (t) => {
  const db = await localDatabase(t);
  const events = await seedAnalytics(db);
  await seedAnalytics(db, { owner: 'other' });

  const reference = await db.prepare(REFERENCE_CHAT_ACTIVITY).bind('u', FROM, TO).all();
  const metered = meter(db);
  const actual = await chatActivityStatement(metered.db, 'u', FROM, TO).all();
  const rows = metered.take();

  assert.equal(actual.results.length, 100);
  assert.deepEqual(actual.results, reference.results);
  // Measured on this seed: 34 771 rows for the reference (chats/profiles joined per event), 19 324 now.
  assert.ok(rows <= events * 2, `per-chat breakdown read ${rows} rows for ${events} events`);
  assert.ok(rows < reference.meta.rows_read * 0.6, `per-chat breakdown read ${rows} rows, reference ${reference.meta.rows_read}`);
});
