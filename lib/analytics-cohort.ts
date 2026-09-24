export type AnalyticsCohortTotals = {
  leads: number;
  bookedLeads: number;
  bookings: number;
  completed: number;
  noShow: number;
};

export type AnalyticsCohortPlatform = AnalyticsCohortTotals & {
  platform: string;
};

export type AnalyticsCohortChat = AnalyticsCohortTotals & {
  id: string;
  name: string;
  platform: string;
};

type CohortRow = {
  platform: string | null;
  chat_id: string | null;
  chat_name: string | null;
  leads: number;
  booked_leads: number;
  bookings: number;
  completed: number;
  no_show: number;
};

export async function readAnalyticsCohort(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
): Promise<{
  totals: AnalyticsCohortTotals;
  platforms: AnalyticsCohortPlatform[];
  chats: AnalyticsCohortChat[];
}> {
  const result = await db.prepare(`WITH cohort AS (
      SELECT DISTINCT lead_id
      FROM activity_events
      WHERE user_id=?1 AND event_type='lead_created' AND event_date>=?2 AND event_date<=?3
        AND cancelled_at IS NULL AND lead_id IS NOT NULL
    ), bookings AS (
      SELECT e.lead_id,COUNT(*) AS bookings
      FROM activity_events e JOIN cohort co ON co.lead_id=e.lead_id
      WHERE e.user_id=?1 AND e.event_type IN ('lesson_booked','curator_booking_pending')
        AND e.cancelled_at IS NULL
      GROUP BY e.lead_id
    ), outcomes AS (
      SELECT lesson.lead_id,
        SUM(CASE WHEN lesson.status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN lesson.status='no-show' THEN 1 ELSE 0 END) AS no_show
      FROM lessons lesson JOIN cohort co ON co.lead_id=lesson.lead_id
      WHERE lesson.user_id=?1 AND lesson.status IN ('completed','no-show')
        AND EXISTS (
          SELECT 1 FROM activity_events booked
          WHERE booked.user_id=lesson.user_id AND booked.lead_id=lesson.lead_id
            AND booked.event_type='lesson_booked' AND booked.cancelled_at IS NULL
        )
      GROUP BY lesson.lead_id
    )
    SELECT COALESCE(l.platform,'unknown') AS platform,l.source_chat_id AS chat_id,c.name AS chat_name,
      COUNT(*) AS leads,
      SUM(CASE WHEN COALESCE(b.bookings,0)>0 THEN 1 ELSE 0 END) AS booked_leads,
      SUM(COALESCE(b.bookings,0)) AS bookings,
      SUM(COALESCE(outcome.completed,0)) AS completed,
      SUM(COALESCE(outcome.no_show,0)) AS no_show
    FROM cohort co
    JOIN leads l ON l.id=co.lead_id AND l.user_id=?1
    LEFT JOIN chats c ON c.id=l.source_chat_id AND c.user_id=l.user_id
    LEFT JOIN bookings b ON b.lead_id=l.id
    LEFT JOIN outcomes outcome ON outcome.lead_id=l.id
    GROUP BY COALESCE(l.platform,'unknown'),l.source_chat_id,c.name
    ORDER BY leads DESC,bookings DESC,COALESCE(c.name,'')`).bind(userId, from, to).all<CohortRow>();

  const totals: AnalyticsCohortTotals = { leads: 0, bookedLeads: 0, bookings: 0, completed: 0, noShow: 0 };
  const byPlatform = new Map<string, AnalyticsCohortPlatform>();
  const chats: AnalyticsCohortChat[] = [];
  for (const row of result.results) {
    const values = {
      leads: Number(row.leads || 0),
      bookedLeads: Number(row.booked_leads || 0),
      bookings: Number(row.bookings || 0),
      completed: Number(row.completed || 0),
      noShow: Number(row.no_show || 0),
    };
    totals.leads += values.leads;
    totals.bookedLeads += values.bookedLeads;
    totals.bookings += values.bookings;
    totals.completed += values.completed;
    totals.noShow += values.noShow;
    const platform = row.platform || 'unknown';
    const current = byPlatform.get(platform) || { platform, leads: 0, bookedLeads: 0, bookings: 0, completed: 0, noShow: 0 };
    current.leads += values.leads;
    current.bookedLeads += values.bookedLeads;
    current.bookings += values.bookings;
    current.completed += values.completed;
    current.noShow += values.noShow;
    byPlatform.set(platform, current);
    if (row.chat_id) chats.push({ id: row.chat_id, name: row.chat_name || 'Без назви', platform, ...values });
  }
  return {
    totals,
    platforms: [...byPlatform.values()].sort((a, b) => b.leads - a.leads || b.bookings - a.bookings || a.platform.localeCompare(b.platform)),
    chats: chats.sort((a, b) => b.leads - a.leads || b.bookings - a.bookings || a.name.localeCompare(b.name, 'uk')),
  };
}
