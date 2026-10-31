-- Індекси під зовнішні ключі (3.8.0). SQLite перевіряє зовнішній ключ при видаленні батька (і при вставці в
-- батьківську таблицю з тригерами) запитом «WHERE колонка = ?» по дочірній таблиці. Без індексу з цією
-- колонкою першою це повний скан дочірньої таблиці на кожен видалений чи доданий рядок: 2026-10-30 так
-- «зникли» мільйони прочитаних рядків, яких не показує d1-insights. Для колонок, що можуть бути NULL,
-- індекс частковий (порожні значення в ньому не зберігаються й не коштують записів).

-- Батько chats
CREATE INDEX IF NOT EXISTS fk_whatsapp_autopost_jobs_chat_idx ON whatsapp_autopost_jobs(chat_id);
CREATE INDEX IF NOT EXISTS fk_telegram_schedule_slots_chat_idx ON telegram_schedule_slots(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_chat_discovery_candidates_imported_chat_idx ON chat_discovery_candidates(imported_chat_id) WHERE imported_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_leads_source_chat_idx ON leads(source_chat_id) WHERE source_chat_id IS NOT NULL;

-- Батько chat_publications
CREATE INDEX IF NOT EXISTS fk_telegram_schedule_slots_publication_idx ON telegram_schedule_slots(publication_id) WHERE publication_id IS NOT NULL;

-- Батько leads
CREATE INDEX IF NOT EXISTS fk_lessons_lead_idx ON lessons(lead_id);
CREATE INDEX IF NOT EXISTS fk_activity_events_lead_idx ON activity_events(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_lead_messages_lead_idx ON lead_messages(lead_id);
CREATE INDEX IF NOT EXISTS fk_lead_commands_lead_idx ON lead_commands(lead_id);
CREATE INDEX IF NOT EXISTS fk_lead_message_attachments_lead_idx ON lead_message_attachments(lead_id);
CREATE INDEX IF NOT EXISTS fk_student_subjects_lead_idx ON student_subjects(lead_id);

-- Батьки lessons, students, lead_messages
CREATE INDEX IF NOT EXISTS fk_activity_events_lesson_idx ON activity_events(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_curator_requests_lesson_idx ON curator_requests(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_lessons_student_idx ON lessons(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fk_lead_message_attachments_message_idx ON lead_message_attachments(message_id);

-- Батько library_items
CREATE INDEX IF NOT EXISTS fk_whatsapp_autopost_jobs_advertisement_idx ON whatsapp_autopost_jobs(advertisement_id);
CREATE INDEX IF NOT EXISTS fk_messenger_automation_jobs_advertisement_idx ON messenger_automation_jobs(advertisement_id);
