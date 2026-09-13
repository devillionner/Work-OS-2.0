import { businessDate } from './business-time.ts';
import { reminderView } from './leads/domain/reminders.ts';
import { readWorkdaySnapshot, type WorkdaySnapshot } from './workday.ts';
import { activitySummaryStatement, activityTotals, type ActivitySummaryRow } from './activity-summary.ts';

export type DashboardSnapshot = {
  today: string;
  workday: WorkdaySnapshot | null;
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
  leadTaskCount: number;
  leadTasks: Array<{ kind: 'follow_up' | 'reminder'; leadId: string; leadName: string; title: string; dueAt: number; lessonId: string | null }>;
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
  const [report, workday] = await Promise.all([
    db.prepare(`SELECT submitted_at FROM daily_reports WHERE user_id=?1 AND report_date=?2 LIMIT 1`)
      .bind(userId, today).first<{ submitted_at: number | null }>(),
    readWorkdaySnapshot(db, userId, today, now),
  ]);
  const afterReport = report?.submitted_at ?? null;
  const reminderHorizon = businessDate(now + 43200 * 60);
  const [chatResult, leadResult, migrationResult, eventResult, settingsResult, followUpResult, reminderResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id=?1 AND workflow_status!='archived'`).bind(userId),
    db.prepare(`SELECT COUNT(*) AS count FROM leads WHERE user_id=?1 AND archived_at IS NULL`).bind(userId),
    db.prepare(`SELECT j.completed_at,i.original_filename FROM migration_jobs j JOIN legacy_imports i ON i.id=j.import_id AND i.user_id=j.user_id WHERE j.user_id=?1 AND j.status='completed' ORDER BY j.completed_at DESC LIMIT 1`).bind(userId),
    activitySummaryStatement(db, userId, today, today, afterReport),
    db.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('focus_directions','daily_booking_goal','monthly_booking_goal','enabled_platforms')`).bind(userId),
    db.prepare(`SELECT id,name,next_action,next_contact_at FROM leads
      WHERE user_id=?1 AND archived_at IS NULL AND next_contact_at IS NOT NULL AND next_contact_at<=?2
      ORDER BY next_contact_at,id LIMIT 50`).bind(userId, now),
    db.prepare(`SELECT r.id,r.slot,r.enabled,r.offset_minutes,r.sent_at,r.skipped_at,
        l.id AS lesson_id,l.lead_id,l.subject,l.student_name,l.teacher_name,l.lesson_date,l.lesson_time,l.lesson_platform,l.meeting_link,l.status,
        d.name AS lead_name
      FROM lesson_reminders r
      JOIN lessons l ON l.id=r.lesson_id AND l.user_id=r.user_id
      JOIN leads d ON d.id=l.lead_id AND d.user_id=r.user_id
      WHERE r.user_id=?1 AND d.archived_at IS NULL AND r.enabled=1 AND r.sent_at IS NULL AND r.skipped_at IS NULL
        AND l.status IN ('booked','scheduled') AND l.lesson_date>=?2 AND l.lesson_date<=?3
      ORDER BY l.lesson_date,l.lesson_time,r.slot LIMIT 200`).bind(userId, today, reminderHorizon),
  ]);
  const chatCount = chatResult.results[0] as { count?: number } | undefined;
  const leadCount = leadResult.results[0] as { count?: number } | undefined;
  const lastSync = migrationResult.results[0] as { completed_at?: number; original_filename?: string } | undefined;
  const eventRows = eventResult.results as ActivitySummaryRow[];
  const settingRows = settingsResult.results as Array<{ setting_key: string; value_json: string }>;
  const followUpRows = followUpResult.results as Array<{ id: string; name: string; next_action: string; next_contact_at: number }>;
  const reminderRows = reminderResult.results as Array<{ id: string; slot: number; enabled: number; offset_minutes: number; sent_at: number | null; skipped_at: number | null; lesson_id: string; lead_id: string; subject: string; student_name: string; teacher_name: string; lesson_date: string; lesson_time: string; lesson_platform: string | null; meeting_link: string; status: string; lead_name: string }>;
  const leadTasks: DashboardSnapshot['leadTasks'] = followUpRows.map(row => ({
    kind: 'follow_up', leadId: row.id, leadName: row.name,
    title: row.next_action.trim() || 'Зв’язатися з лідом', dueAt: Number(row.next_contact_at), lessonId: null,
  }));
  for (const row of reminderRows) {
    const view = reminderView({
      id: row.lesson_id, subject: row.subject, studentName: row.student_name, teacherName: row.teacher_name,
      lessonDate: row.lesson_date, lessonTime: row.lesson_time, lessonPlatform: row.lesson_platform,
      meetingLink: row.meeting_link, status: row.status,
    }, {
      id: row.id, slot: Number(row.slot), enabled: Boolean(row.enabled), offsetMinutes: Number(row.offset_minutes),
      sentAt: row.sent_at === null ? null : Number(row.sent_at), skippedAt: row.skipped_at === null ? null : Number(row.skipped_at),
    }, now);
    if (view.state === 'due' && view.dueAt !== null) leadTasks.push({
      kind: 'reminder', leadId: row.lead_id, leadName: row.lead_name,
      title: `Нагадати про урок: ${row.subject} · ${row.student_name}`, dueAt: view.dueAt, lessonId: row.lesson_id,
    });
  }
  leadTasks.sort((a, b) => a.dueAt - b.dueAt || a.leadId.localeCompare(b.leadId));
  const leadTaskCount = leadTasks.length;
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
    today, workday,
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
    leadTaskCount,
    leadTasks: leadTasks.slice(0, 8),
  };
}

function settingNumber(value: string | undefined): number { try { const parsed = JSON.parse(value || 'null'); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; } catch { return 0; } }
function settingList(value: string | undefined): string[] { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
