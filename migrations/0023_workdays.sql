CREATE TABLE workdays (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL CHECK (length(work_date)=10),
  status TEXT NOT NULL CHECK (status IN ('active','paused','ended')),
  started_at INTEGER NOT NULL,
  active_since INTEGER,
  paused_at INTEGER,
  ended_at INTEGER,
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds>=0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id,work_date),
  CHECK (
    (status='active' AND active_since IS NOT NULL AND paused_at IS NULL AND ended_at IS NULL) OR
    (status='paused' AND active_since IS NULL AND paused_at IS NOT NULL AND ended_at IS NULL) OR
    (status='ended' AND active_since IS NULL AND paused_at IS NULL AND ended_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX workdays_one_open_idx ON workdays(user_id) WHERE status!='ended';
CREATE INDEX workdays_owner_date_idx ON workdays(user_id,work_date DESC);

CREATE TRIGGER backup_revision_workdays_insert AFTER INSERT ON workdays
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(NEW.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER backup_revision_workdays_update AFTER UPDATE ON workdays
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
  INSERT INTO backup_revisions(user_id,revision)
  SELECT NEW.user_id,1 WHERE NEW.user_id!=OLD.user_id
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER backup_revision_workdays_delete AFTER DELETE ON workdays
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1)
  ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
