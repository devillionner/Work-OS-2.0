-- Additive only: retain legacy columns, IDs, business dates and all events.
ALTER TABLE leads ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN response_at INTEGER;
ALTER TABLE leads ADD COLUMN first_reply_at INTEGER;
ALTER TABLE leads ADD COLUMN qualification TEXT CHECK (qualification IN ('A','B','C'));
ALTER TABLE leads ADD COLUMN family_qualification TEXT CHECK (family_qualification IN ('A','B','C'));
ALTER TABLE leads ADD COLUMN duplicate_state TEXT NOT NULL DEFAULT 'none' CHECK (duplicate_state IN ('none','possible','confirmed'));
ALTER TABLE leads ADD COLUMN funnel_stage TEXT NOT NULL DEFAULT 'response' CHECK (funnel_stage IN ('response','clarification','booked','reminder','lesson','result'));
ALTER TABLE leads ADD COLUMN next_action TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN next_contact_at INTEGER;
ALTER TABLE leads ADD COLUMN managed_at INTEGER;
ALTER TABLE leads ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN grade INTEGER CHECK (grade IS NULL OR (typeof(grade)='integer' AND grade BETWEEN 1 AND 11));
ALTER TABLE lessons ADD COLUMN status_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE lessons ADD COLUMN rescheduled_from_id TEXT REFERENCES lessons(id);
CREATE UNIQUE INDEX lessons_one_replacement_idx ON lessons(rescheduled_from_id);
CREATE INDEX leads_follow_up_idx ON leads(user_id,archived_at,next_contact_at);
CREATE INDEX students_lead_idx ON students(user_id,lead_id);
CREATE INDEX lessons_lead_idx ON lessons(user_id,lead_id);
CREATE TABLE lesson_reminders (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lesson_id TEXT NOT NULL REFERENCES lessons(id), slot INTEGER NOT NULL CHECK (slot IN (1,2)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 offset_minutes INTEGER NOT NULL CHECK (offset_minutes BETWEEN 0 AND 43200),
 sent_at INTEGER, skipped_at INTEGER, updated_at INTEGER NOT NULL,
 CHECK (sent_at IS NULL OR skipped_at IS NULL)
);
CREATE UNIQUE INDEX lesson_reminders_slot_idx ON lesson_reminders(lesson_id,slot);
INSERT INTO lesson_reminders (id,user_id,lesson_id,slot,offset_minutes,updated_at)
 SELECT id||':reminder:1',user_id,id,1,1440,updated_at FROM lessons;
INSERT INTO lesson_reminders (id,user_id,lesson_id,slot,offset_minutes,updated_at)
 SELECT id||':reminder:2',user_id,id,2,60,updated_at FROM lessons;
CREATE TABLE lead_messages (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lead_id TEXT NOT NULL REFERENCES leads(id), sender TEXT NOT NULL CHECK(sender IN ('lead','me')),
 body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 20000), sent_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX lead_messages_history_idx ON lead_messages(user_id,lead_id,sent_at,id);
-- Durable idempotency receipts also provide an atomic compare-and-swap guard.
-- The entire command + aggregate changes + events execute in one D1 batch.
CREATE TABLE lead_commands (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lead_id TEXT NOT NULL REFERENCES leads(id), expected_version INTEGER NOT NULL,
 request_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
-- Keep trigger body statements on one physical line for Wrangler remote migration parsing.
CREATE TRIGGER lead_command_version_guard BEFORE INSERT ON lead_commands
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND user_id=NEW.user_id AND version=NEW.expected_version) THEN RAISE(ABORT,'lead_version_conflict') END;
END;
-- Imported duplicate contacts remain valid. Native writes require acknowledgement
-- via possible/confirmed; the trigger closes races between concurrent requests.
CREATE TRIGGER lead_duplicate_insert BEFORE INSERT ON leads WHEN NEW.managed_at IS NOT NULL AND NEW.duplicate_state='none'
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND ((NEW.normalized_phone<>'' AND normalized_phone=NEW.normalized_phone) OR (NEW.normalized_telegram<>'' AND normalized_telegram=NEW.normalized_telegram))) THEN RAISE(ABORT,'lead_duplicate_contact') END;
END;
CREATE TRIGGER lead_duplicate_update BEFORE UPDATE OF normalized_phone,normalized_telegram ON leads
WHEN NEW.managed_at IS NOT NULL AND NEW.duplicate_state='none' AND (OLD.normalized_phone<>NEW.normalized_phone OR OLD.normalized_telegram<>NEW.normalized_telegram)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM leads WHERE user_id=NEW.user_id AND id<>NEW.id AND ((NEW.normalized_phone<>'' AND normalized_phone=NEW.normalized_phone) OR (NEW.normalized_telegram<>'' AND normalized_telegram=NEW.normalized_telegram))) THEN RAISE(ABORT,'lead_duplicate_contact') END;
END;
-- Imports cannot silently overwrite an aggregate already managed in Work OS.
-- A blocked chunk rolls back and the existing migration UI reports the reason.
CREATE TABLE lead_import_guards (lead_id TEXT NOT NULL, user_id TEXT NOT NULL);
CREATE TRIGGER lead_import_guard BEFORE INSERT ON lead_import_guards
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM leads WHERE id=NEW.lead_id AND user_id=NEW.user_id AND managed_at IS NOT NULL) THEN RAISE(ABORT,'Лід уже редагувався у Work OS. Повторний імпорт зупинено, потрібна звірка конфлікту.') END;
 UPDATE leads SET version=version+1 WHERE id=NEW.lead_id AND user_id=NEW.user_id;
 SELECT RAISE(IGNORE);
END;
