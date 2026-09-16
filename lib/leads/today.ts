export type TodayLeadItem = {
  id: string;
  name: string;
  platform: string;
  subject: string;
  latestAt: number;
  eventCount: number;
};

export type TodayLeadsActivity = {
  date: string;
  counters: { responses: number; bookings: number };
  responses: TodayLeadItem[];
  bookings: TodayLeadItem[];
};

const BOOKING_TYPES = "'lesson_booked','curator_booking_pending'";

export async function readTodayLeadsActivity(
  db: D1Database,
  userId: string,
  date: string,
): Promise<TodayLeadsActivity> {
  const [counterResult, responseResult, bookingResult] = await Promise.all([
    db.prepare(`SELECT
      SUM(CASE WHEN event_type='lead_created' AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS responses,
      SUM(CASE WHEN event_type IN (${BOOKING_TYPES}) AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS bookings
      FROM activity_events
      WHERE user_id=?1 AND event_date=?2
        AND event_type IN ('lead_created',${BOOKING_TYPES})`)
      .bind(userId, date)
      .first<{ responses: number | null; bookings: number | null }>(),
    db.prepare(`SELECT l.id,l.name,l.platform,l.subject,MAX(e.occurred_at) AS latest_at,COUNT(*) AS event_count
      FROM activity_events e
      INNER JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND e.event_date=?2
        AND e.event_type='lead_created' AND e.cancelled_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM activity_events booking
          WHERE booking.user_id=e.user_id
            AND booking.lead_id=e.lead_id
            AND booking.event_date=e.event_date
            AND booking.event_type IN (${BOOKING_TYPES})
            AND booking.cancelled_at IS NULL
        )
      GROUP BY l.id,l.name,l.platform,l.subject
      ORDER BY latest_at DESC,l.id ASC`)
      .bind(userId, date)
      .all<RawTodayLeadItem>(),
    db.prepare(`SELECT l.id,l.name,l.platform,l.subject,MAX(e.occurred_at) AS latest_at,COUNT(*) AS event_count
      FROM activity_events e
      INNER JOIN leads l ON l.id=e.lead_id AND l.user_id=e.user_id
      WHERE e.user_id=?1 AND e.event_date=?2
        AND e.event_type IN (${BOOKING_TYPES}) AND e.cancelled_at IS NULL
      GROUP BY l.id,l.name,l.platform,l.subject
      ORDER BY latest_at DESC,l.id ASC`)
      .bind(userId, date)
      .all<RawTodayLeadItem>(),
  ]);

  return {
    date,
    counters: {
      responses: Number(counterResult?.responses || 0),
      bookings: Number(counterResult?.bookings || 0),
    },
    responses: responseResult.results.map(mapItem),
    bookings: bookingResult.results.map(mapItem),
  };
}

type RawTodayLeadItem = {
  id: string;
  name: string;
  platform: string;
  subject: string;
  latest_at: number;
  event_count: number;
};

function mapItem(row: RawTodayLeadItem): TodayLeadItem {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    subject: row.subject,
    latestAt: Number(row.latest_at),
    eventCount: Number(row.event_count),
  };
}
