import { env } from 'cloudflare:workers';

export type DashboardSnapshot = {
  migrationCompleted: boolean;
  chats: number;
  leads: number;
  reportSubmittedAt: number | null;
  pendingAfterReport: number;
  bookingGoal: { completed: number; target: number };
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
  const report = await env.DB.prepare(
    `SELECT report_text,submitted_at FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`,
  ).bind(userId, today).first<{ report_text: string; submitted_at: number | null }>();
  const reportSnapshot = report ? parseReport(report.report_text) : null;
  const afterReport = report?.submitted_at || 0;
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
       WHERE e.user_id=?1 AND e.event_date=?2 AND e.occurred_at>?3
       GROUP BY COALESCE(e.platform,l.platform,c.platform)`,
    ).bind(userId, today, afterReport),
  ]);
  const chatCount = chatResult.results[0] as { count?: number } | undefined;
  const leadCount = leadResult.results[0] as { count?: number } | undefined;
  const migrationCount = migrationResult.results[0] as { count?: number } | undefined;
  const eventRows = eventResult.results as Array<{ platform: string | null; publications: number; responses: number; bookings: number }>;
  const byPlatform = new Map(eventRows.map((row) => [row.platform, row]));
  const pendingAfterReport = report
    ? eventRows.reduce((sum, row) => sum + Number(row.publications || 0) + Number(row.responses || 0) + Number(row.bookings || 0), 0)
    : 0;
  const platforms = ['telegram', 'whatsapp', 'viber', 'facebook'].map((key) => {
    const additions = byPlatform.get(key);
    const base = reportSnapshot?.platforms[key];
    return {
      key, ...PLATFORM_META[key],
      publications: Number(base?.publications || 0) + Number(additions?.publications || 0),
      responses: Number(base?.responses || 0) + Number(additions?.responses || 0),
      bookings: Number(base?.bookings || 0) + Number(additions?.bookings || 0),
    };
  });
  const completedBookings = platforms.reduce((sum, platform) => sum + platform.bookings, 0);
  return {
    migrationCompleted: Number(migrationCount?.count || 0) > 0,
    chats: Number(chatCount?.count || 0),
    leads: Number(leadCount?.count || 0),
    reportSubmittedAt: report?.submitted_at || null,
    pendingAfterReport,
    bookingGoal: { completed: reportSnapshot?.bookingGoal.completed ?? completedBookings, target: reportSnapshot?.bookingGoal.target || 5 },
    platforms,
  };
}

type ParsedReport = {
  platforms: Record<string, { publications: number; responses: number; bookings: number }>;
  bookingGoal: { completed: number; target: number };
};

function parseReport(value: string): ParsedReport {
  const normalized = value.replaceAll('\r\n', '\n');
  const platforms: ParsedReport['platforms'] = {};
  const heading = /^(Telegram|WhatsApp|Viber|Facebook|Threads)\s*$/gm;
  const matches = Array.from(normalized.matchAll(heading));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.search(/\nЦіль по /);
    const section = normalized.slice(start, end > start ? end : undefined);
    const key = match[1].toLowerCase();
    platforms[key] = {
      publications: metric(section, 'Оголошення'),
      responses: metric(section, 'Відгуки'),
      bookings: metric(section, 'Записи'),
    };
  }
  const goalMatch = /Ціль по записам на день:\s*(\d+)\s*\/\s*(\d+)/i.exec(normalized);
  return {
    platforms,
    bookingGoal: { completed: Number(goalMatch?.[1] || 0), target: Number(goalMatch?.[2] || 5) },
  };
}

function metric(section: string, label: string): number {
  return Number(new RegExp(`${label}:\\s*(\\d+)`, 'i').exec(section)?.[1] || 0);
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
