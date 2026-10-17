-- D1 read budget (2026-10-18, d1 insights): closing yesterday's jobs on every claim (`status IN ('pending','claimed') AND
-- published_on<today`) used the (user,day,status) index and read every job the owner ever had (avg 348 rows per call, 64 calls
-- a day). Jobs in work are a handful: this partial index holds only them, so that statement, the stop-batch statement and
-- the lookups of jobs in work read just those rows.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_active_day_idx
  ON whatsapp_autopost_jobs(user_id,published_on)
  WHERE status IN ('pending','claimed');
