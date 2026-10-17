-- D1 read budget (2026-10-17, d1 insights): three scans that read far more rows than they return.
-- 1) Autopost progress / reset / cancel filter jobs by owner and business day, but only (user_id,status,created_at)
--    and (user_id,chat_id,published_on,status) existed, so each call walked every job the owner ever had
--    (avg 289 rows per call, 764 calls a week).
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_owner_day_idx
  ON whatsapp_autopost_jobs(user_id,published_on,status);
-- 2) «Остання задача автопоста» orders by created_at DESC LIMIT 1 and had no index leading with user_id,created_at
--    (avg 570 rows per call).
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_owner_created_idx
  ON whatsapp_autopost_jobs(user_id,created_at DESC,id DESC);
-- 3) The reports calendar counts active lead events per day, but lead_id/cancelled_at are not in any date index, so every
--    event of the month (publications included) was read to be filtered (avg 1 251 rows per call). The partial index
--    holds only the rows the query counts, and GROUP BY event_date is answered from the index alone.
CREATE INDEX IF NOT EXISTS activity_events_user_date_lead_idx
  ON activity_events(user_id,event_date) WHERE lead_id IS NOT NULL AND cancelled_at IS NULL;
