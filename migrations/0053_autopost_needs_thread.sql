-- Telegram: чат із гілками, для якого гілку ще не вибрано, — це не збій і не рішення про помилку, а окремий стан «чекає вибору гілки»
-- (outcome='needs_thread'). Раніше такі задачі закривались як needs_decision і рахувались у «Не вдалося» (2026-10-24, партія 63 чатів).
-- Переносимо вже наявні: вибірка йде частковим індексом `whatsapp_autopost_jobs_decision_idx` (лише needs_decision), тож це кілька рядків.
UPDATE whatsapp_autopost_jobs
  SET outcome='needs_thread'
  WHERE outcome='needs_decision' AND json_extract(result_json,'$.errorCode') IN ('thread_required','thread_closed');
