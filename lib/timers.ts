export type TimerRow = {
  id: string; label: string; platform: string | null; telegram_account_id: string | null;
  duration_seconds: number; started_at: number; ends_at: number; status: string;
  completed_at: number | null; created_at: number;
};

export function publicTimer(row: TimerRow, now: number) {
  const completed = row.status === 'completed' || row.ends_at <= now;
  return {
    id: row.id, label: row.label, platform: row.platform,
    telegramAccountId: row.telegram_account_id, durationSeconds: Number(row.duration_seconds),
    startedAt: Number(row.started_at), endsAt: Number(row.ends_at),
    status: completed ? 'completed' : 'running',
    completedAt: completed ? (row.completed_at ?? row.ends_at) : null,
    createdAt: Number(row.created_at),
  };
}

// Completion is a projection of the persisted deadline, never a write on GET.
export async function readTimers(db: D1Database, userId: string, now: number) {
  const result = await db.prepare(`SELECT id,label,platform,telegram_account_id,duration_seconds,started_at,ends_at,status,completed_at,created_at FROM work_timers WHERE user_id=?1 AND status IN ('running','completed') ORDER BY ends_at`).bind(userId).all<TimerRow>();
  return result.results.map(row => publicTimer(row, now));
}
