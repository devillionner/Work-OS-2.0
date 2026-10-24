-- Проходи «знайти гілки» (Telegram, request_key `scan_…`) нічого не публікують, тож їхня невдача не «Не вдалося» партії: такі задачі
-- закриваються як скасовані (кодом, з 3.3.4). Переносимо вже наявні невдалі проходи; лічильники дня рухає тригер.
UPDATE whatsapp_autopost_jobs SET status='cancelled' WHERE request_key LIKE 'scan\_%' ESCAPE '\' AND status='failed';
