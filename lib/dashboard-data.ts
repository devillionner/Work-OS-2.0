import { businessDate } from './business-time.ts';
import { activitySummaryStatement, activityTotals, type ActivitySummaryRow } from './activity-summary.ts';

export type DashboardSnapshot = {
  migrationCompleted: boolean;
  lastPrototypeSync: { completedAt: number; filename: string } | null;
  chats: number;
  leads: number;
  reportSubmittedAt: number | null;
  pendingAfterReport: number;
  bookingGoal: { completed: number; target: number };
  monthlyBookingGoal: number;
  focusDirections: string[];
  enabledPlatforms: string[];
  platforms: Array<{ key: string; name: string; color: string; publications: number; joined: number; responses: number; bookings: number }>;
};

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#2563eb' },
  whatsapp: { name: 'WhatsApp', color: '#16a34a' },
  viber: { name: 'Viber', color: '#7c3aed' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  threads: { name: 'Threads', color: '#17191e' },
};

export async function readDashboardSnapshot(db: D1Database, userId: string, now: number): Promise<DashboardSnapshot> {
  const today = businessDate(now);
  const report = await db.prepare(
    `SELECT submitted_at FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`,
  ).bind(userId, today).first<{ submitted_at: number | null }>();
  const afterReport = report?.submitted_at ?? null;
  const [chatResult, leadResult, migrationResult, eventResult, settingsResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id=?1 AND workflow_status!='archived'`).bind(userId),
    db.prepare(`SELECT COUNT(*) AS count FROM leads WHERE user_id=?1 AND archived_at IS NULL`).bind(userId),
    db.prepare(`SELECT j.completed_at,i.original_filename FROM migration_jobs j JOIN legacy_imports i ON i.id=j.import_id AND i.user_id=j.user_id WHERE j.user_id=?1 AND j.status='completed' ORDER BY j.completed_at DESC LIMIT 1`).bind(userId),
    activitySummaryStatement(db, userId, today, today, afterReport),
    db.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('focus_directions','daily_booking_goal','monthly_booking_goal','enabled_platforms')`).bind(userId),
  ]);
  const chatCount = chatResult.results[0] as { count?: number } | undefined;
  const leadCount = leadResult.results[0] as { count?: number } | undefined;
  const lastSync = migrationResult.results[0] as { completed_at?: number; original_filename?: string } | undefined;
  const eventRows = eventResult.results as ActivitySummaryRow[];
  const settingRows = settingsResult.results as Array<{ setting_key: string; value_json: string }>;
  const settingMap = new Map(settingRows.map(row => [row.setting_key, row.value_json]));
  const dailyGoal = settingMap.has('daily_booking_goal') ? settingNumber(settingMap.get('daily_booking_goal')) : 5;
  const monthlyBookingGoal = settingMap.has('monthly_booking_goal') ? settingNumber(settingMap.get('monthly_booking_goal')) : 100;
  const focusDirections = settingList(settingMap.get('focus_directions'));
  const enabledPlatforms = settingList(settingMap.get('enabled_platforms'));
  const platformKeys = new Set([...Object.keys(PLATFORM_META), ...eventRows.map(row => row.platform || 'unknown')]);
  const platforms = [...platformKeys].map(key => ({
    key, ...(PLATFORM_META[key] || { name: 'Джерело не вказано', color: '#6b7280' }),
    ...activityTotals(eventRows.filter(row => (row.platform || 'unknown') === key)),
  }));
  return {
    migrationCompleted: Boolean(lastSync?.completed_at),
    lastPrototypeSync: lastSync?.completed_at ? { completedAt: Number(lastSync.completed_at), filename: lastSync.original_filename || 'Prototype Checker' } : null,
    chats: Number(chatCount?.count || 0),
    leads: Number(leadCount?.count || 0),
    reportSubmittedAt: afterReport,
    pendingAfterReport: eventRows.reduce((sum, row) => sum + Number(row.changes_after_report || 0), 0),
    bookingGoal: { completed: activityTotals(eventRows).bookings, target: dailyGoal },
    monthlyBookingGoal,
    focusDirections,
    enabledPlatforms: enabledPlatforms.length ? enabledPlatforms : ['telegram', 'whatsapp', 'viber', 'facebook'],
    platforms,
  };
}

function settingNumber(value: string | undefined): number { try { const parsed = JSON.parse(value || 'null'); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; } catch { return 0; } }
function settingList(value: string | undefined): string[] { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
