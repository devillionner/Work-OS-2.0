-- Additive hardening; no production records are deleted or rewritten.
DROP TRIGGER lead_command_version_guard;
CREATE TABLE lead_write_guards (lead_id TEXT NOT NULL, user_id TEXT NOT NULL, expected_version INTEGER NOT NULL, curator_request_id TEXT);
CREATE TRIGGER lead_write_guard BEFORE INSERT ON lead_write_guards
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND user_id=NEW.user_id AND version=NEW.expected_version)
 THEN RAISE(ABORT,'lead_version_conflict') END;
 SELECT CASE WHEN NEW.curator_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM curator_requests WHERE id=NEW.curator_request_id AND lead_id=NEW.lead_id AND user_id=NEW.user_id AND status='pending') THEN RAISE(ABORT,'lead_version_conflict') END;
 SELECT RAISE(IGNORE);
END;
CREATE INDEX leads_owner_archive_updated_idx ON leads(user_id,archived_at,updated_at DESC,id);
CREATE INDEX events_owner_lead_type_idx ON activity_events(user_id,lead_id,event_type);
CREATE INDEX lead_commands_owner_lead_idx ON lead_commands(user_id,lead_id);
-- A revision is a consistency token for paged backup, never a business metric.
CREATE TABLE backup_revisions (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER backup_revision_legacy_imports_insert AFTER INSERT ON legacy_imports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_legacy_imports_update AFTER UPDATE ON legacy_imports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_legacy_imports_delete AFTER DELETE ON legacy_imports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_accounts_insert AFTER INSERT ON telegram_accounts
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_accounts_update AFTER UPDATE ON telegram_accounts
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_accounts_delete AFTER DELETE ON telegram_accounts
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_work_timers_insert AFTER INSERT ON work_timers
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_work_timers_update AFTER UPDATE ON work_timers
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_work_timers_delete AFTER DELETE ON work_timers
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chats_insert AFTER INSERT ON chats
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chats_update AFTER UPDATE ON chats
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chats_delete AFTER DELETE ON chats
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_publications_insert AFTER INSERT ON chat_publications
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_publications_update AFTER UPDATE ON chat_publications
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_publications_delete AFTER DELETE ON chat_publications
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_leads_insert AFTER INSERT ON leads
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_leads_update AFTER UPDATE ON leads
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_leads_delete AFTER DELETE ON leads
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_students_insert AFTER INSERT ON students
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_students_update AFTER UPDATE ON students
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_students_delete AFTER DELETE ON students
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lessons_insert AFTER INSERT ON lessons
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lessons_update AFTER UPDATE ON lessons
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lessons_delete AFTER DELETE ON lessons
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_curator_requests_insert AFTER INSERT ON curator_requests
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_curator_requests_update AFTER UPDATE ON curator_requests
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_curator_requests_delete AFTER DELETE ON curator_requests
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lesson_reminders_insert AFTER INSERT ON lesson_reminders
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lesson_reminders_update AFTER UPDATE ON lesson_reminders
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lesson_reminders_delete AFTER DELETE ON lesson_reminders
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_messages_insert AFTER INSERT ON lead_messages
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_messages_update AFTER UPDATE ON lead_messages
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_messages_delete AFTER DELETE ON lead_messages
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_commands_insert AFTER INSERT ON lead_commands
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_commands_update AFTER UPDATE ON lead_commands
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_lead_commands_delete AFTER DELETE ON lead_commands
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_daily_reports_insert AFTER INSERT ON daily_reports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_daily_reports_update AFTER UPDATE ON daily_reports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_daily_reports_delete AFTER DELETE ON daily_reports
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_user_settings_insert AFTER INSERT ON user_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_user_settings_update AFTER UPDATE ON user_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_user_settings_delete AFTER DELETE ON user_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_activity_events_insert AFTER INSERT ON activity_events
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_activity_events_update AFTER UPDATE ON activity_events
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_activity_events_delete AFTER DELETE ON activity_events
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_profiles_insert AFTER INSERT ON chat_profiles
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM chats WHERE id=NEW.chat_id),1 WHERE (SELECT user_id FROM chats WHERE id=NEW.chat_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_profiles_update AFTER UPDATE ON chat_profiles
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM chats WHERE id=OLD.chat_id),1 WHERE (SELECT user_id FROM chats WHERE id=OLD.chat_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM chats WHERE id=NEW.chat_id),1 WHERE (SELECT user_id FROM chats WHERE id=NEW.chat_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_chat_profiles_delete AFTER DELETE ON chat_profiles
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM chats WHERE id=OLD.chat_id),1 WHERE (SELECT user_id FROM chats WHERE id=OLD.chat_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_legacy_import_chunks_insert AFTER INSERT ON legacy_import_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM legacy_imports WHERE id=NEW.import_id),1 WHERE (SELECT user_id FROM legacy_imports WHERE id=NEW.import_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_legacy_import_chunks_update AFTER UPDATE ON legacy_import_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM legacy_imports WHERE id=OLD.import_id),1 WHERE (SELECT user_id FROM legacy_imports WHERE id=OLD.import_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM legacy_imports WHERE id=NEW.import_id),1 WHERE (SELECT user_id FROM legacy_imports WHERE id=NEW.import_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_legacy_import_chunks_delete AFTER DELETE ON legacy_import_chunks
BEGIN
 INSERT INTO backup_revisions(user_id,revision) SELECT (SELECT user_id FROM legacy_imports WHERE id=OLD.import_id),1 WHERE (SELECT user_id FROM legacy_imports WHERE id=OLD.import_id) IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
