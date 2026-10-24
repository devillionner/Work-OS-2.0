-- D1 read budget (2026-10-24, d1 insights, 1 день): три запити автопосту читали сотні рядків на виклик.
-- 1) Вибір наступної задачі (`status='pending' AND published_on=?` + `ORDER BY attempts,created_at,id LIMIT 1`) читав усі задачі
--    партії, що чекають, на кожен claim (≈86 рядків, O(n²) на партію). Частковий індекс у порядку вибору віддає одну.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_pending_pick_idx
  ON whatsapp_autopost_jobs(user_id,published_on,attempts,created_at,id)
  WHERE status='pending';
-- 2) «Потребують рішення» за день читали всі сьогоднішні задачі (≈150 рядків, 319 викликів). Індекс містить тільки ці рядки.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_decision_day_idx
  ON whatsapp_autopost_jobs(user_id,published_on)
  WHERE outcome='needs_decision';
