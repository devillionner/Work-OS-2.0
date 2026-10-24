-- Автопост Telegram: тимчасова заборона писати в чат (нічний режим бота, повільний режим, права чату) і виправлення хибно «закритих» гілок.
-- telegram_restricted_at: коли runner востаннє бачив, що в чаті немає поля повідомлення без ознак закритої гілки; NULL — заборони немає.
-- Зміна колонки не чіпає updated_at, щоб задачі в черзі не вважали чат зміненим.
ALTER TABLE chats ADD COLUMN telegram_restricted_at INTEGER;

-- Раніше гілка вважалась закритою, якщо за 2,5 с не з'явилось поле повідомлення (нічний режим бота давав «усі гілки закриті»). Тепер закрита
-- лише гілка зі значком замка. Усі старі позначки «закрита» у чатах, що чекають вибору гілки, повертаємо у відкриті; точні позначки
-- зберуться наступним проходом «Знайти гілки». Частковий індекс chats_telegram_thread_choice_idx обмежує вибірку чатами без вибраної гілки.
UPDATE chats
SET telegram_topics_json=(
  SELECT json_group_array(json_object('id',json_extract(j.value,'$.id'),'title',json_extract(j.value,'$.title'),'closed',json('false')))
  FROM json_each(chats.telegram_topics_json) j
)
WHERE platform='telegram' AND telegram_forum=1 AND telegram_thread_id IS NULL AND telegram_topics_json LIKE '%"closed":true%';
