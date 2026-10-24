-- Автопост Telegram через браузер (Telegram Web). Лише додаємо колонки й індекс, нічого не змінюємо й не переносимо.
-- Платформа задачі автопосту: відбір наступної задачі пропускає Telegram, поки його черга на паузі або чекає свого інтервалу
-- (WhatsApp і Viber не чекають на Telegram). Для старих задач порожньо, вони не Telegram.
ALTER TABLE whatsapp_autopost_jobs ADD COLUMN platform TEXT;

-- Гілка (тема) форуму, куди публікувати: id і назва, а також що runner бачив востаннє (чи форум, список тем із позначкою «закрита»).
-- telegram_forum: NULL — ще не відкривали, 0 — звичайний чат, 1 — чат із гілками. Зміна цих колонок не чіпає updated_at,
-- щоб задачі, які вже стоять у черзі, не вважали чат зміненим.
ALTER TABLE chats ADD COLUMN telegram_forum INTEGER CHECK (telegram_forum IS NULL OR telegram_forum IN (0,1));
ALTER TABLE chats ADD COLUMN telegram_thread_id TEXT;
ALTER TABLE chats ADD COLUMN telegram_thread_title TEXT;
ALTER TABLE chats ADD COLUMN telegram_topics_json TEXT;
ALTER TABLE chats ADD COLUMN telegram_topics_at INTEGER;

-- Чати з гілками, для яких гілку ще не вибрано: група «Вибрати гілку» у картці й у черзі.
CREATE INDEX IF NOT EXISTS chats_telegram_thread_choice_idx
  ON chats(user_id,telegram_account_id)
  WHERE platform='telegram' AND telegram_forum=1 AND telegram_thread_id IS NULL;

-- Який акаунт Telegram Web залогінений у браузері runner: id користувача, прив'язаний оператором. Автопост перевіряє збіг перед кожним чатом.
ALTER TABLE telegram_accounts ADD COLUMN web_user_id TEXT;
