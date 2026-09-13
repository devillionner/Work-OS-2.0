CREATE TABLE report_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL CHECK (length(report_date)=10),
  slot TEXT NOT NULL CHECK (slot IN ('13:00','16:00','19:00')),
  report_text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  submitted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id,report_date,slot)
);

CREATE INDEX report_checkpoints_user_date_idx
  ON report_checkpoints(user_id,report_date,slot);

CREATE TRIGGER backup_revision_report_checkpoints_insert AFTER INSERT ON report_checkpoints
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER backup_revision_report_checkpoints_update AFTER UPDATE ON report_checkpoints
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
  INSERT INTO backup_revisions(user_id,revision) SELECT NEW.user_id,1 WHERE NEW.user_id!=OLD.user_id ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER backup_revision_report_checkpoints_delete AFTER DELETE ON report_checkpoints
BEGIN
  INSERT INTO backup_revisions(user_id,revision) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1;
END;
