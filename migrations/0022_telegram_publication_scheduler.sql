CREATE TABLE telegram_schedule_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_account_id TEXT NOT NULL REFERENCES telegram_accounts(id) ON DELETE CASCADE,
  interval_minutes REAL NOT NULL DEFAULT 8.571428571428571 CHECK (interval_minutes>0),
  base_at REAL NOT NULL DEFAULT 0 CHECK (base_at>=0),
  selection_mode TEXT NOT NULL DEFAULT 'auto' CHECK (selection_mode IN ('auto','manual')),
  manual_chat_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id,telegram_account_id)
);
CREATE TABLE telegram_schedule_slots (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_account_id TEXT NOT NULL REFERENCES telegram_accounts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence>=1),
  scheduled_at REAL NOT NULL CHECK (scheduled_at>=0),
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_at INTEGER,
  publication_id TEXT REFERENCES chat_publications(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id,telegram_account_id,scheduled_at)
);
CREATE INDEX telegram_schedule_slots_pending_idx ON telegram_schedule_slots(user_id,telegram_account_id,status,scheduled_at);
CREATE UNIQUE INDEX telegram_schedule_slots_pending_chat_idx ON telegram_schedule_slots(user_id,telegram_account_id,chat_id) WHERE status='pending' AND chat_id IS NOT NULL;
CREATE TRIGGER telegram_schedule_settings_owner_insert BEFORE INSERT ON telegram_schedule_settings
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=NEW.telegram_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'telegram_schedule_owner_conflict') END;
END;
CREATE TRIGGER telegram_schedule_settings_owner_update BEFORE UPDATE ON telegram_schedule_settings
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=NEW.telegram_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'telegram_schedule_owner_conflict') END;
END;
CREATE TRIGGER telegram_schedule_slots_owner_insert BEFORE INSERT ON telegram_schedule_slots
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=NEW.telegram_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'telegram_schedule_owner_conflict') END;
 SELECT CASE WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.user_id=NEW.user_id AND c.platform='telegram' AND c.telegram_account_id=NEW.telegram_account_id) THEN RAISE(ABORT,'telegram_schedule_chat_conflict') END;
END;
CREATE TRIGGER telegram_schedule_slots_owner_update BEFORE UPDATE ON telegram_schedule_slots
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM telegram_accounts a WHERE a.id=NEW.telegram_account_id AND a.user_id=NEW.user_id) THEN RAISE(ABORT,'telegram_schedule_owner_conflict') END;
 SELECT CASE WHEN NEW.chat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chats c WHERE c.id=NEW.chat_id AND c.user_id=NEW.user_id AND c.platform='telegram' AND c.telegram_account_id=NEW.telegram_account_id) THEN RAISE(ABORT,'telegram_schedule_chat_conflict') END;
END;
CREATE TRIGGER backup_revision_telegram_schedule_settings_insert AFTER INSERT ON telegram_schedule_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_schedule_settings_update AFTER UPDATE ON telegram_schedule_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id!=OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_schedule_settings_delete AFTER DELETE ON telegram_schedule_settings
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_schedule_slots_insert AFTER INSERT ON telegram_schedule_slots
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_schedule_slots_update AFTER UPDATE ON telegram_schedule_slots
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
 INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id!=OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_telegram_schedule_slots_delete AFTER DELETE ON telegram_schedule_slots
BEGIN
 INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
