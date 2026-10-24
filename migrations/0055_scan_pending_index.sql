-- Проходи «знайти гілки» (request_key `scan_…`) мають іти раніше за публікації: claim спершу шукає серед них. Частковий індекс містить
-- лише проходи в черзі (кілька рядків), тож це пошук без обходу всіх задач дня.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_scan_pending_idx
  ON whatsapp_autopost_jobs(user_id,published_on,created_at)
  WHERE status='pending' AND substr(request_key,1,5)='scan_';
