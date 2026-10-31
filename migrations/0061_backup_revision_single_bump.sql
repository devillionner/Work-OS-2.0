-- Тригери ревізії резервної копії (3.8.0): при UPDATE вони двічі піднімали лічильник, навіть коли власник
-- рядка не змінився (друга вставка для NEW.user_id дублює першу для OLD.user_id). Друга вставка тепер лише
-- коли власник змінився: на кожне оновлення рядка менше одного читання й одного запису. Лічильник
-- backup_revisions використовується лише як токен змін (порівняння на рівність), тож крок +1 замість +2 безпечний.

DROP TRIGGER IF EXISTS backup_revision_activity_events_update;
CREATE TRIGGER backup_revision_activity_events_update AFTER UPDATE ON activity_events BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_chat_publications_update;
CREATE TRIGGER backup_revision_chat_publications_update AFTER UPDATE ON chat_publications BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_chats_update;
CREATE TRIGGER backup_revision_chats_update AFTER UPDATE ON chats BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_curator_requests_update;
CREATE TRIGGER backup_revision_curator_requests_update AFTER UPDATE ON curator_requests BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_daily_reports_update;
CREATE TRIGGER backup_revision_daily_reports_update AFTER UPDATE ON daily_reports BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_dev_items_update;
CREATE TRIGGER backup_revision_dev_items_update AFTER UPDATE ON dev_items BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lead_commands_update;
CREATE TRIGGER backup_revision_lead_commands_update AFTER UPDATE ON lead_commands BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lead_message_attachment_chunks_update;
CREATE TRIGGER backup_revision_lead_message_attachment_chunks_update AFTER UPDATE ON lead_message_attachment_chunks BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lead_message_attachments_update;
CREATE TRIGGER backup_revision_lead_message_attachments_update AFTER UPDATE ON lead_message_attachments BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lead_messages_update;
CREATE TRIGGER backup_revision_lead_messages_update AFTER UPDATE ON lead_messages BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_leads_update;
CREATE TRIGGER backup_revision_leads_update AFTER UPDATE ON leads BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_legacy_imports_update;
CREATE TRIGGER backup_revision_legacy_imports_update AFTER UPDATE ON legacy_imports BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lesson_reminders_update;
CREATE TRIGGER backup_revision_lesson_reminders_update AFTER UPDATE ON lesson_reminders BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_lessons_update;
CREATE TRIGGER backup_revision_lessons_update AFTER UPDATE ON lessons BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_student_subjects_update;
CREATE TRIGGER backup_revision_student_subjects_update AFTER UPDATE ON student_subjects BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_students_update;
CREATE TRIGGER backup_revision_students_update AFTER UPDATE ON students BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_telegram_accounts_update;
CREATE TRIGGER backup_revision_telegram_accounts_update AFTER UPDATE ON telegram_accounts BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_user_settings_update;
CREATE TRIGGER backup_revision_user_settings_update AFTER UPDATE ON user_settings BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_work_timers_update;
CREATE TRIGGER backup_revision_work_timers_update AFTER UPDATE ON work_timers BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;

DROP TRIGGER IF EXISTS backup_revision_workday_pauses_update;
CREATE TRIGGER backup_revision_workday_pauses_update AFTER UPDATE ON workday_pauses BEGIN INSERT INTO backup_revisions(user_id,revision) SELECT OLD.user_id,1 WHERE OLD.user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;
