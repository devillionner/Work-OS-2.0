-- Telegram: «черга приєднання». Чат у `to_join` із заповненим join_candidate_at і закріпленим telegram_account_id — у черзі
-- вибраного акаунта; без нього — серед «Нових чатів». Колонка адитивна й nullable: без перебудови таблиці, без зміни
-- CHECK статусів і без тригерів (форма міграції така сама, як у 0040).
ALTER TABLE chats ADD COLUMN join_candidate_at INTEGER;
