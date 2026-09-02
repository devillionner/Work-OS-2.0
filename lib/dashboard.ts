import { env } from 'cloudflare:workers';

export type DashboardSnapshot = {
  migrationCompleted: boolean;
  chats: number;
  leads: number;
  platforms: Array<{ key: string; name: string; color: string; publications: number; responses: number; bookings: number }>;
};

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#2563eb' },
  whatsapp: { name: 'WhatsApp', color: '#16a34a' },
  viber: { name: 'Viber', color: '#7c3aed' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  threads: { name: 'Threads', color: '#17191e' },
};

export async function getDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  const today = kyivDate();
  const [chatResult, leadResult, migrationResult, eventResult] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id=?1 AND workflow_status!='archived'`).bind(userId),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM leads WHERE user_id=?1 AND archived_at IS NULL`).bind(userId),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM migration_jobs WHERE user_id=?1 AND status='completed'`).bind(userId),
    env.DB.prepare(
      `SELECT COALESCE(e.platform,l.platform,c.platform) AS platform,
       SUM(CASE WHEN e.event_type='publication' THEN 1 ELSE 0 END) AS publications,
       SUM(CASE WHEN e.event_type='lead_created' THEN 1 ELSE 0 END) AS responses,
       SUM(CASE WHEN e.event_type='lesson_booked' THEN 1 ELSE 0 END) AS bookings
       FROM activity_events e
       LEFT JOIN leads l ON l.id=e.lead_id
       LEFT JOIN chats c ON c.id=e.chat_id
       WHERE e.user_id=?1 AND e.event_date=?2
       GROUP BY COALESCE(e.platform,l.platform,c.platform)`,
    ).bind(userId, today),
  ]);
  const chatCount = chatResult.results[0] as { count?: number } | undefined;
  const leadCount = leadResult.results[0] as { count?: number } | undefined;
  const migrationCount = migrationResult.results[0] as { count?: number } | undefined;
  const eventRows = eventResult.results as Array<{ platform: string | null; publications: number; responses: number; bookings: number }>;
  const byPlatform = new Map(eventRows.map((row) => [row.platform, row]));
  return {
    migrationCompleted: Number(migrationCount?.count || 0) > 0,
    chats: Number(chatCount?.count || 0),
    leads: Number(leadCount?.count || 0),
    platforms: ['telegram', 'whatsapp', 'viber', 'facebook'].map((key) => {
      const row = byPlatform.get(key);
      return { key, ...PLATFORM_META[key], publications: Number(row?.publications || 0), responses: Number(row?.responses || 0), bookings: Number(row?.bookings || 0) };
    }),
  };
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
