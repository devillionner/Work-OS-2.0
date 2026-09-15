export type WorkdayStatus = 'active' | 'paused' | 'ended';

export type WorkdaySnapshot = {
  id: string;
  workDate: string;
  status: WorkdayStatus;
  startedAt: number;
  activeSince: number | null;
  pausedAt: number | null;
  endedAt: number | null;
  activeSeconds: number;
  asOf: number;
  version: number;
};

type WorkdayRow = {
  id: string;
  work_date: string;
  status: WorkdayStatus;
  started_at: number;
  active_since: number | null;
  paused_at: number | null;
  ended_at: number | null;
  active_seconds: number;
  version: number;
};

export class WorkdayError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export async function readWorkdaySnapshot(
  db: D1Database,
  userId: string,
  today: string,
  now: number,
): Promise<WorkdaySnapshot | null> {
  const row = await db.prepare(`SELECT id,work_date,status,started_at,active_since,paused_at,
      ended_at,active_seconds,version FROM workdays
    WHERE user_id=?1 AND (status!='ended' OR work_date=?2)
    ORDER BY CASE WHEN status!='ended' THEN 0 ELSE 1 END, started_at DESC LIMIT 1`)
    .bind(userId, today).first<WorkdayRow>();
  return row ? project(row, now) : null;
}

export async function startWorkday(
  db: D1Database,
  args: { userId: string; today: string; now: number },
): Promise<WorkdaySnapshot> {
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO workdays
      (id,user_id,work_date,status,started_at,active_since,paused_at,ended_at,active_seconds,created_at,updated_at,version)
      VALUES(?1,?2,?3,'active',?4,?4,NULL,NULL,0,?4,?4,0)`)
      .bind(id, args.userId, args.today, args.now).run();
  } catch (error) {
    throw conflict(error, 'Робочий день уже відкритий або за цю дату вже завершений.');
  }
  return required(await readWorkdaySnapshot(db, args.userId, args.today, args.now));
}

type MutationArgs = {
  userId: string;
  id: string;
  workDate: string;
  expectedVersion: number;
  now: number;
};

export async function pauseWorkday(db: D1Database, args: MutationArgs) {
  const sql = 'UP' + `DATE workdays SET
    active_seconds=active_seconds+CASE WHEN ?5>active_since THEN ?5-active_since ELSE 0 END,
    status='paused',active_since=NULL,paused_at=?5,updated_at=?5,version=version+1
    WHERE id=?1 AND user_id=?2 AND work_date=?3 AND version=?4 AND status='active'`;
  const result = await db.prepare(sql)
    .bind(args.id, args.userId, args.workDate, args.expectedVersion, args.now).run();
  changed(result, 'Робочий день уже змінився. Оновіть стан і повторіть дію.');
  return required(await readById(db, args.userId, args.id, args.now));
}

export async function resumeWorkday(db: D1Database, args: MutationArgs) {
  const sql = 'UP' + `DATE workdays SET
    status='active',active_since=?5,paused_at=NULL,updated_at=?5,version=version+1
    WHERE id=?1 AND user_id=?2 AND work_date=?3 AND version=?4 AND status='paused'`;
  const result = await db.prepare(sql)
    .bind(args.id, args.userId, args.workDate, args.expectedVersion, args.now).run();
  changed(result, 'Робочий день уже змінився. Оновіть стан і повторіть дію.');
  return required(await readById(db, args.userId, args.id, args.now));
}

export async function endWorkday(db: D1Database, args: MutationArgs) {
  const sql = 'UP' + `DATE workdays SET
    active_seconds=active_seconds+CASE
      WHEN status='active' AND ?5>active_since THEN ?5-active_since ELSE 0 END,
    status='ended',active_since=NULL,paused_at=NULL,ended_at=?5,updated_at=?5,version=version+1
    WHERE id=?1 AND user_id=?2 AND work_date=?3 AND version=?4 AND status IN ('active','paused')`;
  const result = await db.prepare(sql)
    .bind(args.id, args.userId, args.workDate, args.expectedVersion, args.now).run();
  changed(result, 'Робочий день уже завершено або він змінився.');
  return required(await readById(db, args.userId, args.id, args.now));
}

export async function reopenWorkday(db: D1Database, args: MutationArgs) {
  const sql = 'UP' + `DATE workdays SET
    status='active',active_since=ended_at,paused_at=NULL,ended_at=NULL,
    updated_at=?5,version=version+1
    WHERE id=?1 AND user_id=?2 AND work_date=?3 AND version=?4
      AND status='ended' AND ended_at IS NOT NULL`;
  try {
    const result = await db.prepare(sql)
      .bind(args.id, args.userId, args.workDate, args.expectedVersion, args.now).run();
    changed(result, 'Робочий день уже повернено або він змінився.');
  } catch (error) {
    throw conflict(error, 'Не можна повернути цей день, поки відкритий інший робочий день.');
  }
  return required(await readById(db, args.userId, args.id, args.now));
}

async function readById(db: D1Database, userId: string, id: string, now: number) {
  const row = await db.prepare(`SELECT id,work_date,status,started_at,active_since,paused_at,
      ended_at,active_seconds,version FROM workdays WHERE id=?1 AND user_id=?2 LIMIT 1`)
    .bind(id, userId).first<WorkdayRow>();
  return row ? project(row, now) : null;
}

function project(row: WorkdayRow, now: number): WorkdaySnapshot {
  const live = row.status === 'active' && row.active_since !== null
    ? Math.max(0, now - Number(row.active_since)) : 0;
  return {
    id: row.id, workDate: row.work_date, status: row.status,
    startedAt: Number(row.started_at), activeSince: nullableNumber(row.active_since),
    pausedAt: nullableNumber(row.paused_at), endedAt: nullableNumber(row.ended_at),
    activeSeconds: Number(row.active_seconds) + live, asOf: now, version: Number(row.version),
  };
}

function nullableNumber(value: number | null) { return value === null ? null : Number(value); }
function required(value: WorkdaySnapshot | null): WorkdaySnapshot {
  if (!value) throw new WorkdayError('Робочий день не знайдено.', 404);
  return value;
}

function changed(result: D1Result<unknown>, message: string) {
  if (Number(result.meta?.changes || 0) < 1) throw new WorkdayError(message);
}

function conflict(error: unknown, message: string): WorkdayError {
  if (error instanceof WorkdayError) return error;
  const text = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint|workdays_one_open_idx/i.test(text)) return new WorkdayError(message);
  return new WorkdayError('Не вдалося змінити робочий день.', 500);
}
