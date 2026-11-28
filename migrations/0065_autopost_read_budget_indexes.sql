-- Бюджет D1 у дні автопосту (d1-insights 2026-11-28, топ читань). Лише індекси, дані не змінюються.
-- Вартість: кожен CREATE INDEX один раз читає свою таблицю (задачі автопосту двічі, ≈ десятки тисяч рядків; library_items ≈ 1–2 тис.).
--
-- 1) Видача наступної задачі (`claimWhatsAppAutopostJob`): індекс 0051 упорядкований за (attempts, created_at) без платформи, тож коли
--    платформа на паузі чи чекає свого темпу, пошук перебирав усі її задачі в черзі (у середньому 107–235 рядків на виклик, ≈ 520 викликів
--    на день). З платформою в ключі кожна платформа дає свою першу задачу одним рядком.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_pending_platform_idx
  ON whatsapp_autopost_jobs(user_id,published_on,platform,attempts,created_at,id)
  WHERE status='pending';

-- 2) Хід партії (`readAutopostBatch`): повтори «Спробувати ще» / «Без фото» (ключ `retry_<uuid>`) читались діапазоном ключа по всій історії
--    (≈ 110 рядків на виклик і далі росте). Частковий індекс лише `retry_`-задач за днем.
CREATE INDEX IF NOT EXISTS whatsapp_autopost_jobs_retry_day_idx
  ON whatsapp_autopost_jobs(user_id,published_on,created_at)
  WHERE substr(request_key,1,6)='retry_';

-- 3) Оголошення Бібліотеки для автопосту (`readLibraryAds`, матеріал проходу гілок): індекс колекції містить і тексти пулу Telegram (`tgp_`,
--    сотні активних), які запит одразу відкидав (≈ 170 рядків на виклик). Тут лише оголошення без пулу.
CREATE INDEX IF NOT EXISTS library_items_ads_no_pool_idx
  ON library_items(user_id,archived_at,updated_at DESC)
  WHERE collection='advertisement' AND NOT (id>='tgp_' AND id<'tgp`');
