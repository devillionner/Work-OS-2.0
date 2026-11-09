-- 3.15.0: пул текстів автопосту Telegram. Текст пулу за добу видається один раз, тож «чи зайнятий текст» і «які тексти зайняті сьогодні»
-- читаються по цьому індексу (user_id, platform, published_on, advertisement_id), а не скануванням усіх задач доби.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_platform_day_ad_idx
  ON whatsapp_autopost_jobs(user_id, platform, published_on, advertisement_id, status);
